//! Versioned migration of the settings document.
//!
//! # The gap this fills
//!
//! [`crate::settings_repair`] already heals a settings file whose *types* are
//! wrong — `"minimize_to_tray": "yes"` resets one field and keeps the rest. It
//! cannot help with the other failure mode, which is the more common one in a
//! long-lived app:
//!
//! > The document deserializes perfectly, and means the wrong thing.
//!
//! Two shapes of that:
//!
//! * **A field changed meaning.** `theme_accent` becomes `accent_id`, a
//!   duration moves from seconds to milliseconds, an enum variant is renamed.
//!   Serde sees a missing key and a valid unknown one, resets to the default,
//!   and the user silently loses a setting they configured.
//! * **An invariant is violated by values that are individually valid.** The
//!   worked example below: two `global_hotkeys` entries naming the same action.
//!   Every field type-checks. The app misbehaves anyway.
//!
//! Neither is detectable from types, so neither can be repaired from types.
//! What they need is a record of *which schema wrote this file*, which is what
//! [`VERSION_FIELD`] is for.
//!
//! # Add the version field before you need it
//!
//! This is the part that is easy to postpone and impossible to retrofit. A file
//! written by a build that had no version field is indistinguishable from one
//! written by a build at version 0 — but also from version 3, if the field was
//! added at version 4. The hook has to exist from the start, which is why a
//! template ships it with the ladder already wired up rather than as advice.
//!
//! # Order of operations, and why it is not negotiable
//!
//! ```text
//! read file -> parse JSON -> MIGRATE -> repair -> deserialize -> rewrite
//!                            ^^^^^^^
//! ```
//!
//! Migration runs on the **raw** [`serde_json::Value`], before repair and
//! before deserialization, because that is the only point at which the old
//! shape still exists. Once repair has merged the document over the current
//! defaults, a renamed key has already been replaced by its default and there
//! is nothing left to migrate. Reading the version has the same constraint: the
//! merge would fill in a missing `settings_version` from the current default
//! and report every legacy file as already up to date.
//!
//! # Adding a step
//!
//! 1. Write a function taking `&mut Map<String, Value>` and returning a list of
//!    human-readable descriptions of what it changed (empty when it changed
//!    nothing — that is what keeps a clean file from being rewritten on every
//!    launch).
//! 2. Add a row to [`STEPS`] with the version it produces.
//! 3. Bump [`CURRENT_SETTINGS_VERSION`] to match.
//! 4. Add a test with a *real* legacy document as its input.
//!
//! Steps run in ascending order and each one sees the output of the last, so a
//! file three versions behind is brought forward one step at a time rather than
//! needing an N×N matrix of direct conversions.
//!
//! The versioned-ladder idea is borrowed from
//! [AIVORelay](https://github.com/MaxITService/AIVORelay), whose settings module
//! carries both seed-version stamps and a `migrate_legacy_settings_fields` pass
//! for exactly these two failure modes.

use serde_json::{Map, Value};

/// Schema version this build writes.
///
/// Bump it in the same commit as the step that produces it, never separately:
/// a bumped constant with no matching step silently marks legacy files as
/// current, and a step with no bump re-runs forever.
pub const CURRENT_SETTINGS_VERSION: u32 = 1;

/// Key holding the schema version inside `settings.json`.
pub const VERSION_FIELD: &str = "settings_version";

/// One rung of the ladder.
struct Step {
    /// Version the document is at *after* this step runs.
    produces: u32,
    /// Short description used in the startup log.
    name: &'static str,
    /// Returns one description per change made; empty means "nothing to do".
    apply: fn(&mut Map<String, Value>) -> Vec<String>,
}

/// Every migration, in ascending order of the version it produces.
const STEPS: &[Step] = &[Step {
    produces: 1,
    name: "normalize global hotkey bindings",
    apply: normalize_global_hotkeys,
}];

/// What [`migrate`] did, for the caller to log and to decide on a rewrite.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct MigrationOutcome {
    /// Version the document was at before any step ran. `0` means the file
    /// predates versioning.
    pub from: u32,
    /// Human-readable descriptions of every change, across every step.
    pub changes: Vec<String>,
    /// True when the document was modified at all — including the case where a
    /// step changed nothing but the version stamp still had to be written.
    pub changed: bool,
}

/// Reads the recorded schema version, treating anything unusable as `0`.
///
/// A missing field means "written before versioning existed", which is exactly
/// version 0. A field of the wrong type means a hand-edit, and re-running the
/// migrations is the safe reading: every step below is written to be
/// idempotent, so a needless re-run costs nothing while a wrongly skipped
/// migration leaves a broken document.
fn stored_version(document: &Map<String, Value>) -> u32 {
    document
        .get(VERSION_FIELD)
        .and_then(Value::as_u64)
        .and_then(|version| u32::try_from(version).ok())
        .unwrap_or(0)
}

/// Brings a raw settings document up to [`CURRENT_SETTINGS_VERSION`].
///
/// Returns `None` when the document is not a JSON object, which is the caller's
/// signal that there is nothing here to migrate — a bare array or scalar is
/// handled by the quarantine path, not by this module.
pub fn migrate(document: &mut Value) -> Option<MigrationOutcome> {
    let object = document.as_object_mut()?;
    let from = stored_version(object);

    // A file written by a *newer* build than this one: the user downgraded, or
    // is running two versions against one profile. Applying old steps to a new
    // schema is how you corrupt a document that was fine, so nothing runs — and
    // the version is deliberately left alone rather than stamped downward, so
    // the newer build still knows its own migrations have been applied.
    if from > CURRENT_SETTINGS_VERSION {
        log::warn!(
            "[settings] settings.json reports schema version {from}, newer than this build's \
             {CURRENT_SETTINGS_VERSION}. Running without migration; settings added by the newer \
             version are preserved but ignored."
        );
        return Some(MigrationOutcome {
            from,
            changes: Vec::new(),
            changed: false,
        });
    }

    let mut changes = Vec::new();
    for step in STEPS.iter().filter(|step| step.produces > from) {
        let step_changes = (step.apply)(object);
        if !step_changes.is_empty() {
            log::info!(
                "[settings] Migration to v{} ({}): {} change(s)",
                step.produces,
                step.name,
                step_changes.len()
            );
        }
        changes.extend(step_changes);
    }

    // Stamp the version even when no step had anything to do. That is the
    // normal case — most files are already well-formed — and writing it is what
    // stops the ladder from being re-walked on every single launch.
    let needs_stamp = stored_version(object) != CURRENT_SETTINGS_VERSION;
    if needs_stamp {
        object.insert(
            VERSION_FIELD.to_string(),
            Value::from(CURRENT_SETTINGS_VERSION),
        );
    }

    Some(MigrationOutcome {
        changed: needs_stamp || !changes.is_empty(),
        from,
        changes,
    })
}

/// **v0 → v1.** Enforces one binding per action, and one action per chord.
///
/// # The bug this fixes
///
/// `global_hotkeys` is a list, but it has always been a map in disguise: at
/// most one binding per action. Nothing enforced that on the way in from disk,
/// and the two consumers disagree about what a duplicate means:
///
/// * `bindings_for_ui` (what Preferences shows) uses `.find()` — **first wins**.
/// * `GlobalHotkeys::apply` iterates every entry and registers each one —
///   **all of them win**.
///
/// So a document containing
///
/// ```json
/// [ { "action": "toggle_window", "spec": "Ctrl+Alt+A" },
///   { "action": "toggle_window", "spec": "Ctrl+Alt+B" } ]
/// ```
///
/// gives the user two live system-wide chords while Preferences shows one. The
/// second is invisible and cannot be cleared from the UI without editing that
/// row, because only then does `set_global_hotkey`'s `retain` remove both.
///
/// The same document is *already* rejected on two of the three paths in:
/// `set_global_hotkey` refuses a spec bound to another action, and
/// `sanitizeGlobalHotkeys` in `src/lib/settingsBackup.ts` drops duplicate
/// actions on import. Only the disk loader had no opinion — which is precisely
/// the kind of asymmetry that survives review, because each path looks correct
/// on its own.
///
/// # Rules, chosen to agree with what the user already sees
///
/// * The **first** entry for an action wins, matching `bindings_for_ui`.
/// * The **first** entry claiming a chord wins, matching the conflict error
///   `set_global_hotkey` returns.
/// * An entry whose spec is empty or whitespace is dropped: that is the
///   representation of "unbound", and storing it explicitly is noise that
///   `parse_bindings` skips anyway.
/// * Specs are trimmed, so `" Ctrl+Alt+A"` and `"Ctrl+Alt+A"` are recognized as
///   the same chord rather than registered twice.
/// * An entry this step does not understand — not an object, or without string
///   `action` and `spec` — is **kept, in place**. Migration must never eat data
///   it cannot interpret; `settings_repair` runs next and is the layer that
///   deals with malformed values.
///
/// Idempotent: running it on already-normalized bindings returns no changes.
fn normalize_global_hotkeys(document: &mut Map<String, Value>) -> Vec<String> {
    let Some(bindings) = document
        .get_mut("global_hotkeys")
        .and_then(Value::as_array_mut)
    else {
        return Vec::new();
    };

    let mut changes = Vec::new();
    let mut seen_actions: Vec<String> = Vec::new();
    let mut seen_specs: Vec<String> = Vec::new();
    let mut kept: Vec<Value> = Vec::with_capacity(bindings.len());

    for entry in bindings.iter() {
        // Anything we cannot read is passed through untouched, deliberately.
        let Some((action, spec)) = entry.as_object().and_then(|object| {
            let action = object.get("action")?.as_str()?.to_string();
            let spec = object.get("spec")?.as_str()?.trim().to_string();
            Some((action, spec))
        }) else {
            kept.push(entry.clone());
            continue;
        };

        if spec.is_empty() {
            changes.push(format!(
                "dropped the empty binding for '{action}' (an unbound action needs no entry)"
            ));
            continue;
        }
        if seen_actions.contains(&action) {
            changes.push(format!(
                "dropped a duplicate binding '{spec}' for '{action}' — it was registered as a \
                 second, invisible system-wide hotkey"
            ));
            continue;
        }
        if seen_specs.contains(&spec) {
            changes.push(format!(
                "dropped '{action}' because '{spec}' was already bound to another action"
            ));
            continue;
        }

        // Rebuilt rather than cloned so a trimmed spec is actually persisted,
        // and so any extra keys a hand-edit added do not survive into a
        // document the backend will re-serialize without them.
        let mut normalized = Map::new();
        normalized.insert("action".to_string(), Value::from(action.clone()));
        normalized.insert("spec".to_string(), Value::from(spec.clone()));
        if entry.get("spec").and_then(Value::as_str) != Some(spec.as_str()) {
            changes.push(format!(
                "trimmed surrounding whitespace from '{action}' spec"
            ));
        }

        seen_actions.push(action);
        seen_specs.push(spec);
        kept.push(Value::Object(normalized));
    }

    *bindings = kept;
    changes
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Runs a migration and returns the document plus its outcome.
    fn migrated(input: Value) -> (Value, MigrationOutcome) {
        let mut document = input;
        let outcome = migrate(&mut document).expect("an object document must migrate");
        (document, outcome)
    }

    #[test]
    fn a_versionless_file_is_treated_as_version_zero_and_stamped() {
        let (document, outcome) = migrated(json!({ "theme_accent": "violet" }));

        assert_eq!(outcome.from, 0);
        assert!(outcome.changed, "the version stamp itself is a change");
        assert_eq!(document[VERSION_FIELD], json!(CURRENT_SETTINGS_VERSION));
        // Untouched fields must survive: a migration is not a reset.
        assert_eq!(document["theme_accent"], json!("violet"));
    }

    #[test]
    fn an_up_to_date_file_is_left_completely_alone() {
        // The common case, and the one that must not cause a disk write on
        // every launch.
        let (document, outcome) = migrated(json!({
            VERSION_FIELD: CURRENT_SETTINGS_VERSION,
            "global_hotkeys": [{ "action": "toggle_window", "spec": "Ctrl+Alt+A" }],
        }));

        assert!(!outcome.changed);
        assert!(outcome.changes.is_empty());
        assert_eq!(
            document["global_hotkeys"],
            json!([{ "action": "toggle_window", "spec": "Ctrl+Alt+A" }])
        );
    }

    #[test]
    fn a_duplicate_action_loses_its_invisible_second_hotkey() {
        // The bug in one test: two entries for one action registered two live
        // chords while Preferences showed one.
        let (document, outcome) = migrated(json!({
            "global_hotkeys": [
                { "action": "toggle_window", "spec": "Ctrl+Alt+A" },
                { "action": "toggle_window", "spec": "Ctrl+Alt+B" },
            ],
        }));

        assert_eq!(
            document["global_hotkeys"],
            json!([{ "action": "toggle_window", "spec": "Ctrl+Alt+A" }]),
            "the first binding wins, matching what the UI already displayed"
        );
        assert_eq!(outcome.changes.len(), 1);
        assert!(outcome.changes[0].contains("Ctrl+Alt+B"));
    }

    #[test]
    fn one_chord_cannot_stay_bound_to_two_actions() {
        let (document, _) = migrated(json!({
            "global_hotkeys": [
                { "action": "show_window", "spec": "Ctrl+Alt+S" },
                { "action": "check_updates", "spec": "Ctrl+Alt+S" },
            ],
        }));

        assert_eq!(
            document["global_hotkeys"],
            json!([{ "action": "show_window", "spec": "Ctrl+Alt+S" }])
        );
    }

    #[test]
    fn whitespace_only_specs_are_dropped_as_unbound() {
        let (document, outcome) = migrated(json!({
            "global_hotkeys": [
                { "action": "toggle_window", "spec": "" },
                { "action": "show_window", "spec": "   " },
                { "action": "check_updates", "spec": "Ctrl+Alt+U" },
            ],
        }));

        assert_eq!(
            document["global_hotkeys"],
            json!([{ "action": "check_updates", "spec": "Ctrl+Alt+U" }])
        );
        assert_eq!(outcome.changes.len(), 2);
    }

    #[test]
    fn a_padded_spec_is_trimmed_so_it_matches_its_twin() {
        let (document, outcome) = migrated(json!({
            "global_hotkeys": [
                { "action": "toggle_window", "spec": "  Ctrl+Alt+A  " },
                { "action": "show_window", "spec": "Ctrl+Alt+A" },
            ],
        }));

        // Without trimming, these look like different chords and both survive —
        // then both register, and the second silently shadows the first.
        assert_eq!(
            document["global_hotkeys"],
            json!([{ "action": "toggle_window", "spec": "Ctrl+Alt+A" }])
        );
        assert!(
            outcome
                .changes
                .iter()
                .any(|change| change.contains("trimmed"))
        );
    }

    #[test]
    fn entries_the_step_cannot_read_are_preserved_for_the_repair_pass() {
        // Migration must not destroy what it does not understand — the repair
        // stage runs next and is the layer that knows how to fix a bad value.
        let (document, _) = migrated(json!({
            "global_hotkeys": [
                { "action": "toggle_window", "spec": 12345 },
                "not even an object",
                { "action": "show_window", "spec": "Ctrl+Alt+S" },
            ],
        }));

        let bindings = document["global_hotkeys"].as_array().expect("array");
        assert_eq!(bindings.len(), 3);
        assert_eq!(bindings[0]["spec"], json!(12345));
        assert_eq!(bindings[1], json!("not even an object"));
    }

    #[test]
    fn migration_is_idempotent() {
        // Re-running must be a no-op. It is what makes it safe to re-run after
        // an unparseable version field, and what stops a rewrite loop.
        let (once, _) = migrated(json!({
            "global_hotkeys": [
                { "action": "toggle_window", "spec": "Ctrl+Alt+A" },
                { "action": "toggle_window", "spec": "Ctrl+Alt+B" },
            ],
        }));
        let (twice, second_outcome) = migrated(once.clone());

        assert_eq!(once, twice);
        assert!(!second_outcome.changed);
    }

    #[test]
    fn a_file_from_a_newer_build_is_not_downgraded() {
        // A user running an older build against a profile a newer build wrote.
        // Applying old steps to a new schema is how a good document gets
        // corrupted, so nothing runs — and the stamp is left high so the newer
        // build does not later re-run migrations it has already applied.
        let future = CURRENT_SETTINGS_VERSION + 7;
        let (document, outcome) = migrated(json!({
            VERSION_FIELD: future,
            "global_hotkeys": [
                { "action": "toggle_window", "spec": "Ctrl+Alt+A" },
                { "action": "toggle_window", "spec": "Ctrl+Alt+B" },
            ],
        }));

        assert_eq!(outcome.from, future);
        assert!(!outcome.changed);
        assert_eq!(document[VERSION_FIELD], json!(future));
        assert_eq!(
            document["global_hotkeys"].as_array().map(Vec::len),
            Some(2),
            "a newer schema's data must be left exactly as found"
        );
    }

    #[test]
    fn a_corrupt_version_field_re_runs_the_ladder_rather_than_skipping_it() {
        // `"settings_version": "one"` is a hand-edit. Every step is idempotent,
        // so re-running costs nothing while skipping could leave a real defect
        // in place.
        let (document, outcome) = migrated(json!({
            VERSION_FIELD: "one",
            "global_hotkeys": [
                { "action": "toggle_window", "spec": "Ctrl+Alt+A" },
                { "action": "toggle_window", "spec": "Ctrl+Alt+B" },
            ],
        }));

        assert_eq!(outcome.from, 0);
        assert_eq!(document[VERSION_FIELD], json!(CURRENT_SETTINGS_VERSION));
        assert_eq!(document["global_hotkeys"].as_array().map(Vec::len), Some(1));
    }

    #[test]
    fn a_non_object_document_is_not_this_modules_problem() {
        assert_eq!(migrate(&mut json!([1, 2, 3])), None);
        assert_eq!(migrate(&mut json!("nope")), None);
    }

    #[test]
    fn missing_global_hotkeys_is_not_an_error() {
        let (document, outcome) = migrated(json!({ "minimize_to_tray": true }));
        assert!(outcome.changes.is_empty());
        assert_eq!(document["minimize_to_tray"], json!(true));
    }

    #[test]
    fn every_step_produces_a_version_at_or_below_the_current_one() {
        // Guards the bump-and-step pairing described in the module docs.
        let highest = STEPS.iter().map(|step| step.produces).max().unwrap_or(0);
        assert_eq!(
            highest, CURRENT_SETTINGS_VERSION,
            "CURRENT_SETTINGS_VERSION must equal the highest step; a mismatch either \
             re-runs a step forever or skips it silently"
        );

        // …and the ladder has no gaps or repeats, which would make
        // `produces > from` filtering skip or double-apply a rung.
        let produced: Vec<u32> = STEPS.iter().map(|step| step.produces).collect();
        let expected: Vec<u32> = (1..=CURRENT_SETTINGS_VERSION).collect();
        assert_eq!(produced, expected, "steps must be 1..=CURRENT, in order");
    }
}
