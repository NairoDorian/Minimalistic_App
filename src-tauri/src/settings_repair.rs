//! Field-level self-healing for the persisted settings file.
//!
//! # Why this exists
//!
//! `#[serde(default)]` on every field of `AppSettings` handles a *missing*
//! field, but it does nothing for a field that is present with the **wrong
//! type**. A single `"minimize_to_tray": "yes"` — a hand-edit, a botched
//! migration, a half-written file recovered by the filesystem — makes
//! `serde_json::from_str::<AppSettings>` fail for the whole document, and the
//! naive response (quarantine the file, start from defaults) throws away every
//! *other* preference the user had set. One bad character costs the accent
//! colour, the hotkeys, the window geometry and the tray behaviour.
//!
//! # What this does instead
//!
//! The loader repairs the document one field at a time and keeps the rest:
//!
//! 1. Parse the file as an untyped [`serde_json::Value`]. Only a document that
//!    is not valid JSON at all is unrecoverable.
//! 2. Merge it over the serialized defaults, so absent keys are materialized
//!    and a key whose *shape* disagrees with the default (object where a scalar
//!    belongs, and so on) is replaced before serde ever sees it.
//! 3. Deserialize through [`serde_path_to_error`], which reports the exact JSON
//!    path of the offending value — `theme_accent`, `global_hotkeys[2].action`
//!    — rather than a byte offset.
//! 4. Reset just that path to its default, record it, and try again. Repeat
//!    until it deserializes or the attempt budget runs out.
//!
//! The result is the user's settings with the broken fields — and only the
//! broken fields — reset, plus a list of what was repaired so the caller can
//! log it and the file can be rewritten in its healed form.
//!
//! # Provenance
//!
//! The approach is adapted from the `deserialize_settings_value_with_repair`
//! routine in [AIVORelay](https://github.com/MaxITService/AIVORelay), a
//! production Tauri 2 application whose settings struct is large enough that
//! all-or-nothing loading was not survivable. This is a compact reimplementation
//! for a flat settings struct; see `DOCUMENTATION.md` for the full list of
//! practices borrowed from that project.

use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value};

/// Upper bound on repair rounds.
///
/// Each round fixes at least one field, so the budget only has to exceed the
/// number of fields that can plausibly be broken at once. It exists purely so
/// that a pathological document — one where repairing a path somehow surfaces
/// another error at the same path forever — terminates instead of hanging the
/// app at startup.
const MAX_REPAIR_ROUNDS: usize = 64;

/// Outcome of a repairing deserialization.
#[derive(Debug)]
pub struct RepairOutcome<T> {
    /// The deserialized value: the user's data with broken fields reset.
    pub value: T,
    /// JSON paths that had to be reset, in the order they were repaired.
    /// Empty when the document deserialized cleanly on the first attempt.
    pub repaired_paths: Vec<String>,
    /// True when the on-disk document did not already match its healed form —
    /// because a field was repaired, a key was missing, or a shape disagreed.
    /// The caller should rewrite the file so the next launch starts clean.
    pub needs_rewrite: bool,
}

/// One step of a JSON path: an object key or an array index.
#[derive(Debug, PartialEq, Eq)]
enum PathSegment {
    Key(String),
    Index(usize),
}

/// Parses the dotted path `serde_path_to_error` produces.
///
/// The format is `a.b[0].c` for nested access, and `.` alone for the root. Array
/// indices appear both as `[0]` and — for maps keyed by integers — as bare `0`
/// path components, so a numeric component is treated as an index only when it
/// indexes an array at that position, which [`value_at_path`] resolves later.
fn parse_path(path: &str) -> Vec<PathSegment> {
    let mut segments = Vec::new();

    for component in path.split('.') {
        if component.is_empty() {
            continue;
        }

        // Split `name[0][1]` into the name and each bracketed index.
        let mut rest = component;
        if let Some(bracket) = rest.find('[') {
            let (name, indices) = rest.split_at(bracket);
            if !name.is_empty() {
                segments.push(segment_for(name));
            }
            rest = indices;

            for chunk in rest.split('[').filter(|c| !c.is_empty()) {
                let digits = chunk.trim_end_matches(']');
                match digits.parse::<usize>() {
                    Ok(index) => segments.push(PathSegment::Index(index)),
                    Err(_) => segments.push(PathSegment::Key(digits.to_string())),
                }
            }
        } else {
            segments.push(segment_for(rest));
        }
    }

    segments
}

/// A bare numeric component addresses an array element; anything else is a key.
fn segment_for(component: &str) -> PathSegment {
    match component.parse::<usize>() {
        Ok(index) => PathSegment::Index(index),
        Err(_) => PathSegment::Key(component.to_string()),
    }
}

/// Resolves a path against a document, or `None` if any step is missing.
fn value_at_path<'a>(root: &'a Value, path: &[PathSegment]) -> Option<&'a Value> {
    let mut current = root;
    for segment in path {
        current = match segment {
            PathSegment::Key(key) => current.as_object()?.get(key)?,
            PathSegment::Index(index) => current.as_array()?.get(*index)?,
        };
    }
    Some(current)
}

/// Writes `replacement` at `path`, returning false if the path does not exist.
fn set_value_at_path(root: &mut Value, path: &[PathSegment], replacement: Value) -> bool {
    let Some((last, parents)) = path.split_last() else {
        *root = replacement;
        return true;
    };

    let mut current = root;
    for segment in parents {
        current = match segment {
            PathSegment::Key(key) => match current.as_object_mut() {
                Some(map) => match map.get_mut(key) {
                    Some(child) => child,
                    None => return false,
                },
                None => return false,
            },
            PathSegment::Index(index) => match current.as_array_mut() {
                Some(items) => match items.get_mut(*index) {
                    Some(child) => child,
                    None => return false,
                },
                None => return false,
            },
        };
    }

    match last {
        PathSegment::Key(key) => match current.as_object_mut() {
            // `insert` rather than `get_mut`: the key may be absent entirely,
            // which is exactly the case when serde rejected a missing field.
            Some(map) => {
                map.insert(key.clone(), replacement);
                true
            }
            None => false,
        },
        PathSegment::Index(index) => match current.as_array_mut() {
            Some(items) => match items.get_mut(*index) {
                Some(slot) => {
                    *slot = replacement;
                    true
                }
                None => false,
            },
            None => false,
        },
    }
}

/// Deletes the value at `path`, returning false if it was not there.
///
/// Used as the fallback when a path has no counterpart in the defaults — an
/// array element, say, whose default array is empty. Dropping the element lets
/// the surrounding structure survive; resetting it is not an option because
/// there is nothing to reset it to.
fn remove_value_at_path(root: &mut Value, path: &[PathSegment]) -> bool {
    let Some((last, parents)) = path.split_last() else {
        return false;
    };

    let mut current = root;
    for segment in parents {
        current = match segment {
            PathSegment::Key(key) => match current.as_object_mut().and_then(|m| m.get_mut(key)) {
                Some(child) => child,
                None => return false,
            },
            PathSegment::Index(index) => {
                match current.as_array_mut().and_then(|a| a.get_mut(*index)) {
                    Some(child) => child,
                    None => return false,
                }
            }
        };
    }

    match last {
        PathSegment::Key(key) => current
            .as_object_mut()
            .is_some_and(|map| map.remove(key).is_some()),
        PathSegment::Index(index) => match current.as_array_mut() {
            Some(items) if *index < items.len() => {
                items.remove(*index);
                true
            }
            _ => false,
        },
    }
}

/// Overlays `current` onto `defaults`, key by key.
///
/// * Objects merge recursively, so a key the user has never seen arrives with
///   its default rather than being absent.
/// * Arrays keep the user's elements, but each element is merged against the
///   *first* default element when one exists — that element acts as the shape
///   template for the collection.
/// * A scalar keeps the user's value when it has the same JSON type as the
///   default, and falls back to the default when the types disagree. This is
///   what turns `"minimize_to_tray": "yes"` back into `false` before serde is
///   ever asked to look at it.
/// * A `null` default means "no opinion about the shape", so the user's value
///   passes through untouched.
fn merge_with_defaults(defaults: &Value, current: &Value) -> Value {
    match (defaults, current) {
        (Value::Object(default_map), Value::Object(current_map)) => {
            let mut merged: Map<String, Value> = default_map.clone();
            for (key, current_child) in current_map {
                let merged_child = match default_map.get(key) {
                    Some(default_child) => merge_with_defaults(default_child, current_child),
                    // Unknown keys are preserved rather than dropped: a file
                    // written by a *newer* build must survive a downgrade, and
                    // serde ignores fields the struct does not declare anyway.
                    None => current_child.clone(),
                };
                merged.insert(key.clone(), merged_child);
            }
            Value::Object(merged)
        }
        (Value::Array(default_items), Value::Array(current_items)) => Value::Array(
            current_items
                .iter()
                .map(|item| match default_items.first() {
                    Some(template) => merge_with_defaults(template, item),
                    None => item.clone(),
                })
                .collect(),
        ),
        (Value::Null, current) => current.clone(),
        // Same JSON kind (both bools, both numbers, both strings…): trust the
        // stored value. `discriminant` compares the variant, not the contents.
        (defaults, current)
            if std::mem::discriminant(defaults) == std::mem::discriminant(current) =>
        {
            current.clone()
        }
        (defaults, _) => defaults.clone(),
    }
}

/// Resets the value that serde rejected, walking up the path until something
/// can be replaced.
///
/// The reported path may point deeper than anything the defaults describe — an
/// element of a collection that defaults to empty, for instance — so each
/// shorter prefix is tried in turn, and dropping the value is the last resort.
fn repair_at_path(candidate: &mut Value, defaults: &Value, path: &str) -> bool {
    let segments = parse_path(path);
    if segments.is_empty() {
        return false;
    }

    for prefix_len in (1..=segments.len()).rev() {
        let prefix = &segments[..prefix_len];
        if let Some(default_value) = value_at_path(defaults, prefix)
            && set_value_at_path(candidate, prefix, default_value.clone())
        {
            return true;
        }
        if remove_value_at_path(candidate, prefix) {
            return true;
        }
    }

    false
}

/// Deserializes `stored`, resetting individual fields that fail rather than
/// discarding the whole document.
///
/// Returns `None` only when the value cannot be salvaged at all — which, given
/// that the merge step already forces the document into the default's shape,
/// means a type whose `Deserialize` impl rejects even its own default.
///
/// See the module docs for the algorithm and why it beats all-or-nothing.
pub fn deserialize_with_repair<T>(stored: &Value, defaults: &T) -> Option<RepairOutcome<T>>
where
    T: DeserializeOwned + Serialize,
{
    let default_value = serde_json::to_value(defaults).ok()?;
    let mut candidate = merge_with_defaults(&default_value, stored);

    // The merge itself is a repair: if it changed anything, the file on disk
    // disagrees with what the app is about to use and should be rewritten.
    let mut needs_rewrite = candidate != *stored;
    let mut repaired_paths = Vec::new();

    for _ in 0..MAX_REPAIR_ROUNDS {
        let serialized = candidate.to_string();
        let mut deserializer = serde_json::Deserializer::from_str(&serialized);

        match serde_path_to_error::deserialize::<_, T>(&mut deserializer) {
            Ok(value) => {
                return Some(RepairOutcome {
                    value,
                    repaired_paths,
                    needs_rewrite,
                });
            }
            Err(error) => {
                let path = error.path().to_string();
                if !repair_at_path(&mut candidate, &default_value, &path) {
                    return None;
                }
                repaired_paths.push(path);
                needs_rewrite = true;
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
    struct Nested {
        label: String,
        weight: u8,
    }

    #[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
    struct Sample {
        #[serde(default)]
        enabled: bool,
        #[serde(default)]
        name: String,
        #[serde(default)]
        count: u32,
        #[serde(default)]
        items: Vec<Nested>,
    }

    impl Default for Sample {
        fn default() -> Self {
            Self {
                enabled: true,
                name: "default-name".to_string(),
                count: 7,
                items: vec![Nested {
                    label: "template".to_string(),
                    weight: 1,
                }],
            }
        }
    }

    fn repair(json: &str) -> RepairOutcome<Sample> {
        let stored: Value = serde_json::from_str(json).expect("test input must be valid JSON");
        deserialize_with_repair(&stored, &Sample::default()).expect("should be salvageable")
    }

    #[test]
    fn clean_document_is_returned_untouched() {
        let stored = serde_json::to_value(Sample::default()).unwrap();
        let outcome = deserialize_with_repair(&stored, &Sample::default()).unwrap();

        assert_eq!(outcome.value, Sample::default());
        assert!(outcome.repaired_paths.is_empty());
        assert!(
            !outcome.needs_rewrite,
            "nothing changed, nothing to rewrite"
        );
    }

    #[test]
    fn a_wrong_typed_field_is_reset_and_every_other_field_survives() {
        // The whole point: one bad field must not cost the user the rest.
        let outcome = repair(r#"{ "enabled": "yes", "name": "kept", "count": 42, "items": [] }"#);

        assert_eq!(outcome.value.enabled, Sample::default().enabled);
        assert_eq!(outcome.value.name, "kept");
        assert_eq!(outcome.value.count, 42);
        assert!(outcome.value.items.is_empty());
        assert!(outcome.needs_rewrite);
    }

    #[test]
    fn several_broken_fields_are_all_repaired() {
        let outcome = repair(r#"{ "enabled": 3, "name": [], "count": "many" }"#);

        assert_eq!(outcome.value, Sample::default());
        assert!(outcome.needs_rewrite);
    }

    #[test]
    fn missing_fields_are_filled_from_defaults_and_flagged_for_rewrite() {
        let outcome = repair(r#"{ "name": "only-this" }"#);

        assert_eq!(outcome.value.name, "only-this");
        assert_eq!(outcome.value.enabled, Sample::default().enabled);
        assert_eq!(outcome.value.count, Sample::default().count);
        assert!(
            outcome.needs_rewrite,
            "the file lacked keys the struct declares"
        );
    }

    #[test]
    fn unknown_keys_are_preserved_through_the_merge() {
        // A file written by a newer build must survive a downgrade: serde skips
        // fields the struct does not declare, and the merge must not drop them
        // before serde gets a chance to.
        let stored: Value =
            serde_json::from_str(r#"{ "name": "x", "future_field": { "a": 1 } }"#).unwrap();
        let outcome = deserialize_with_repair(&stored, &Sample::default()).unwrap();

        assert_eq!(outcome.value.name, "x");
    }

    #[test]
    fn a_broken_element_inside_a_collection_is_repaired_in_place() {
        let outcome = repair(
            r#"{ "items": [ { "label": "good", "weight": 2 }, { "label": "bad", "weight": "heavy" } ] }"#,
        );

        assert_eq!(outcome.value.items.len(), 2);
        assert_eq!(outcome.value.items[0].label, "good");
        assert_eq!(outcome.value.items[0].weight, 2);
        // The second element's weight fell back to the template element's value.
        assert_eq!(outcome.value.items[1].label, "bad");
        assert_eq!(outcome.value.items[1].weight, 1);
    }

    #[test]
    fn an_out_of_range_number_is_reset_rather_than_rejected() {
        // 300 does not fit in the u8 the field declares — serde errors, and the
        // path-directed repair puts the template value back.
        let outcome = repair(r#"{ "items": [ { "label": "x", "weight": 300 } ] }"#);

        assert_eq!(outcome.value.items[0].weight, 1);
        assert!(outcome.needs_rewrite);
    }

    #[test]
    fn a_scalar_where_an_object_belongs_is_replaced_wholesale() {
        let outcome = repair(r#"{ "items": 5, "name": "kept" }"#);

        assert_eq!(outcome.value.items, Sample::default().items);
        assert_eq!(outcome.value.name, "kept");
    }

    #[test]
    fn path_parsing_handles_keys_indices_and_nesting() {
        assert_eq!(parse_path(""), vec![]);
        assert_eq!(parse_path("name"), vec![PathSegment::Key("name".into())]);
        assert_eq!(
            parse_path("items[2].label"),
            vec![
                PathSegment::Key("items".into()),
                PathSegment::Index(2),
                PathSegment::Key("label".into()),
            ]
        );
        assert_eq!(
            parse_path("grid[0][1]"),
            vec![
                PathSegment::Key("grid".into()),
                PathSegment::Index(0),
                PathSegment::Index(1),
            ]
        );
    }

    #[test]
    fn merge_keeps_a_same_typed_scalar_and_replaces_a_mismatched_one() {
        let defaults = serde_json::json!({ "a": true, "b": 1, "c": "s" });
        let stored = serde_json::json!({ "a": false, "b": "nope", "c": "kept" });

        assert_eq!(
            merge_with_defaults(&defaults, &stored),
            serde_json::json!({ "a": false, "b": 1, "c": "kept" })
        );
    }

    #[test]
    fn merge_treats_a_null_default_as_no_opinion() {
        let defaults = serde_json::json!({ "anything": null });
        let stored = serde_json::json!({ "anything": { "deep": [1, 2] } });

        assert_eq!(merge_with_defaults(&defaults, &stored), stored);
    }
}
