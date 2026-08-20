//! Modifier key flags, parsing, and match semantics.
//!
//! `Modifiers` is a hand-rolled bitset rather than a `bitflags!` invocation:
//! the type has nine flags and a fixed API surface, so owning it outright keeps
//! this module dependency-free apart from the OS bindings it cannot avoid.
//!
//! Every physical modifier has a **left** and a **right** flag. The compound
//! constants (`CMD`, `SHIFT`, `CTRL`, `OPT`) are both sides OR-ed together and
//! mean "either side" when used in a hotkey pattern — see [`Modifiers::matches`].

use serde::{Deserialize, Serialize};
use std::fmt;
use std::ops::{BitAnd, BitAndAssign, BitOr, BitOrAssign, Not};
use std::str::FromStr;

use crate::hotkeys::error::{Error, Result};

/// A set of modifier keys.
///
/// Serializes transparently as the raw `u32` bit pattern, so a persisted hotkey
/// stays compact and stable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(transparent)]
pub struct Modifiers(u32);

impl Modifiers {
    // ── Side-specific flags ────────────────────────────────────────────────
    pub const CMD_LEFT: Self = Self(1 << 0);
    pub const SHIFT_LEFT: Self = Self(1 << 1);
    pub const CTRL_LEFT: Self = Self(1 << 2);
    pub const OPT_LEFT: Self = Self(1 << 3);
    /// The laptop `Fn` key. macOS-only: Windows and Linux never see it — it is
    /// handled in keyboard firmware and never reaches the OS.
    pub const FN: Self = Self(1 << 4);
    pub const CMD_RIGHT: Self = Self(1 << 5);
    pub const SHIFT_RIGHT: Self = Self(1 << 6);
    pub const CTRL_RIGHT: Self = Self(1 << 7);
    pub const OPT_RIGHT: Self = Self(1 << 8);

    // ── Compound aliases — "either side" ───────────────────────────────────
    pub const CMD: Self = Self(Self::CMD_LEFT.0 | Self::CMD_RIGHT.0);
    pub const SHIFT: Self = Self(Self::SHIFT_LEFT.0 | Self::SHIFT_RIGHT.0);
    pub const CTRL: Self = Self(Self::CTRL_LEFT.0 | Self::CTRL_RIGHT.0);
    pub const OPT: Self = Self(Self::OPT_LEFT.0 | Self::OPT_RIGHT.0);

    /// Every defined flag — the universe `!` complements against.
    pub const ALL: Self =
        Self(Self::CMD.0 | Self::SHIFT.0 | Self::CTRL.0 | Self::OPT.0 | Self::FN.0);

    /// The empty set.
    pub const fn empty() -> Self {
        Self(0)
    }

    /// The raw bit pattern.
    pub const fn bits(self) -> u32 {
        self.0
    }

    /// Builds a set from raw bits, discarding any undefined ones.
    pub const fn from_bits_truncate(bits: u32) -> Self {
        Self(bits & Self::ALL.0)
    }

    /// True when no modifier is set.
    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }

    /// True when **every** flag in `other` is set here.
    pub const fn contains(self, other: Self) -> bool {
        (self.0 & other.0) == other.0
    }

    /// True when **any** flag in `other` is set here.
    pub const fn intersects(self, other: Self) -> bool {
        (self.0 & other.0) != 0
    }

    /// Set union (const, so it can build other constants).
    pub const fn union(self, other: Self) -> Self {
        Self(self.0 | other.0)
    }

    /// Set intersection.
    pub const fn intersection(self, other: Self) -> Self {
        Self(self.0 & other.0)
    }

    /// Everything in `self` that is not in `other`.
    pub const fn difference(self, other: Self) -> Self {
        Self(self.0 & !other.0)
    }

    /// Adds every flag in `other`.
    pub fn insert(&mut self, other: Self) {
        self.0 |= other.0;
    }

    /// Clears every flag in `other`.
    pub fn remove(&mut self, other: Self) {
        self.0 &= !other.0;
    }

    /// The modifier an OS uses for application commands: ⌘ on macOS, Ctrl
    /// everywhere else.
    ///
    /// Resolving `Mod` here rather than at the call site means one persisted
    /// spec string — `"Mod+Shift+K"` — is portable between a Mac and a PC, and
    /// matches the `MOD.PRIMARY` flag in the frontend engine
    /// (`src/lib/keyboard.ts`).
    pub const fn primary() -> Self {
        #[cfg(target_os = "macos")]
        {
            Self::CMD
        }
        #[cfg(not(target_os = "macos"))]
        {
            Self::CTRL
        }
    }
}

impl BitOr for Modifiers {
    type Output = Self;
    fn bitor(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
}

impl BitOrAssign for Modifiers {
    fn bitor_assign(&mut self, rhs: Self) {
        self.0 |= rhs.0;
    }
}

impl BitAnd for Modifiers {
    type Output = Self;
    fn bitand(self, rhs: Self) -> Self {
        Self(self.0 & rhs.0)
    }
}

impl BitAndAssign for Modifiers {
    fn bitand_assign(&mut self, rhs: Self) {
        self.0 &= rhs.0;
    }
}

impl Not for Modifiers {
    type Output = Self;

    /// Complement **within the defined flags** (matching `bitflags` semantics),
    /// so `!CMD` never sets bits that aren't real modifiers.
    fn not(self) -> Self {
        Self(Self::ALL.0 & !self.0)
    }
}

/// All modifier groups as (left, right, compound) triples.
const GROUPS: [(Modifiers, Modifiers, Modifiers); 4] = [
    (Modifiers::CMD_LEFT, Modifiers::CMD_RIGHT, Modifiers::CMD),
    (
        Modifiers::SHIFT_LEFT,
        Modifiers::SHIFT_RIGHT,
        Modifiers::SHIFT,
    ),
    (Modifiers::CTRL_LEFT, Modifiers::CTRL_RIGHT, Modifiers::CTRL),
    (Modifiers::OPT_LEFT, Modifiers::OPT_RIGHT, Modifiers::OPT),
];

impl fmt::Display for Modifiers {
    /// Renders the canonical spec form, e.g. `Shift+Cmd` or `CtrlLeft`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut parts: Vec<&str> = Vec::new();

        // Ctrl, Opt, Shift, Cmd — the conventional display order.
        for (left, right, compound, names) in [
            (
                Modifiers::CTRL_LEFT,
                Modifiers::CTRL_RIGHT,
                Modifiers::CTRL,
                ["Ctrl", "CtrlLeft", "CtrlRight"],
            ),
            (
                Modifiers::OPT_LEFT,
                Modifiers::OPT_RIGHT,
                Modifiers::OPT,
                ["Opt", "OptLeft", "OptRight"],
            ),
            (
                Modifiers::SHIFT_LEFT,
                Modifiers::SHIFT_RIGHT,
                Modifiers::SHIFT,
                ["Shift", "ShiftLeft", "ShiftRight"],
            ),
            (
                Modifiers::CMD_LEFT,
                Modifiers::CMD_RIGHT,
                Modifiers::CMD,
                ["Cmd", "CmdLeft", "CmdRight"],
            ),
        ] {
            if self.contains(compound) {
                parts.push(names[0]);
            } else if self.contains(left) {
                parts.push(names[1]);
            } else if self.contains(right) {
                parts.push(names[2]);
            }
        }

        if self.contains(Modifiers::FN) {
            parts.push("Fn");
        }

        write!(f, "{}", parts.join("+"))
    }
}

impl Modifiers {
    /// Parses a single modifier name (case-insensitive).
    pub(crate) fn parse_single(s: &str) -> Option<Modifiers> {
        match s.to_lowercase().as_str() {
            // Platform-resolving primary modifier — also the spelling Tauri and
            // Electron accelerators use, and what the frontend engine emits.
            "mod" | "cmdorctrl" | "commandorcontrol" | "cmdorcontrol" => Some(Modifiers::primary()),

            // Compound (either side)
            "cmd" | "command" | "meta" | "super" | "win" | "windows" => Some(Modifiers::CMD),
            "shift" => Some(Modifiers::SHIFT),
            "ctrl" | "control" => Some(Modifiers::CTRL),
            "opt" | "option" | "alt" => Some(Modifiers::OPT),
            "fn" | "function" => Some(Modifiers::FN),

            // Left-specific
            "cmdleft" | "cmd_left" | "lcmd" | "commandleft" | "command_left" | "lcommand"
            | "superleft" | "super_left" | "winleft" | "win_left" | "windowsleft"
            | "windows_left" | "metaleft" | "meta_left" => Some(Modifiers::CMD_LEFT),
            "shiftleft" | "shift_left" | "lshift" => Some(Modifiers::SHIFT_LEFT),
            "ctrlleft" | "ctrl_left" | "lctrl" | "controlleft" | "control_left" | "lcontrol" => {
                Some(Modifiers::CTRL_LEFT)
            }
            "optleft" | "opt_left" | "lopt" | "optionleft" | "option_left" | "loption"
            | "altleft" | "alt_left" | "lalt" => Some(Modifiers::OPT_LEFT),

            // Right-specific
            "cmdright" | "cmd_right" | "rcmd" | "commandright" | "command_right" | "rcommand"
            | "superright" | "super_right" | "winright" | "win_right" | "windowsright"
            | "windows_right" | "metaright" | "meta_right" => Some(Modifiers::CMD_RIGHT),
            "shiftright" | "shift_right" | "rshift" => Some(Modifiers::SHIFT_RIGHT),
            "ctrlright" | "ctrl_right" | "rctrl" | "controlright" | "control_right"
            | "rcontrol" => Some(Modifiers::CTRL_RIGHT),
            "optright" | "opt_right" | "ropt" | "optionright" | "option_right" | "roption"
            | "altright" | "alt_right" | "ralt" | "altgr" => Some(Modifiers::OPT_RIGHT),

            _ => None,
        }
    }

    /// Checks whether `self` (as a hotkey pattern) matches `event` (the actual
    /// modifier state).
    ///
    /// For each group (Cmd, Shift, Ctrl, Opt):
    /// - pattern has both bits (compound): the event must have at least one
    /// - pattern has a specific side: the event must have that side (extra
    ///   same-group bits are fine)
    /// - pattern has neither: the event must not have either bit
    ///
    /// `FN` is matched exactly.
    pub fn matches(self, event: Modifiers) -> bool {
        for &(left, right, _compound) in &GROUPS {
            let hotkey_has_left = self.contains(left);
            let hotkey_has_right = self.contains(right);
            let event_has_left = event.contains(left);
            let event_has_right = event.contains(right);
            let event_has_any = event_has_left || event_has_right;

            if hotkey_has_left && hotkey_has_right {
                if !event_has_any {
                    return false;
                }
            } else if hotkey_has_left {
                if !event_has_left {
                    return false;
                }
            } else if hotkey_has_right {
                if !event_has_right {
                    return false;
                }
            } else if event_has_any {
                return false;
            }
        }

        self.contains(Modifiers::FN) == event.contains(Modifiers::FN)
    }
}

impl FromStr for Modifiers {
    type Err = Error;

    /// Parses modifiers from a string like `"Cmd+Shift"` or `"Ctrl+Alt"`.
    fn from_str(s: &str) -> Result<Self> {
        let s = s.trim();
        if s.is_empty() {
            return Ok(Modifiers::empty());
        }

        let mut modifiers = Modifiers::empty();
        for part in s.split('+') {
            let part = part.trim();
            if part.is_empty() {
                continue;
            }
            match Modifiers::parse_single(part) {
                Some(m) => modifiers |= m,
                None => return Err(Error::UnknownModifier(part.to_string())),
            }
        }
        Ok(modifiers)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bitset_operations() {
        let both = Modifiers::CMD_LEFT | Modifiers::SHIFT_LEFT;
        assert!(both.contains(Modifiers::CMD_LEFT));
        assert!(!both.contains(Modifiers::CMD));
        assert!(both.intersects(Modifiers::CMD));
        assert!(!both.is_empty());
        assert!(Modifiers::empty().is_empty());

        let mut m = Modifiers::empty();
        m.insert(Modifiers::CTRL_RIGHT);
        assert!(m.contains(Modifiers::CTRL_RIGHT));
        m.remove(Modifiers::CTRL_RIGHT);
        assert!(m.is_empty());

        assert_eq!(both & Modifiers::CMD, Modifiers::CMD_LEFT);
        assert_eq!(both.difference(Modifiers::CMD), Modifiers::SHIFT_LEFT);
    }

    #[test]
    fn complement_stays_inside_defined_flags() {
        // `!` must behave like bitflags: complement within ALL, never raw bits.
        assert_eq!(!Modifiers::ALL, Modifiers::empty());
        assert_eq!((!Modifiers::CMD).bits() & !Modifiers::ALL.bits(), 0);
        assert!(!(!Modifiers::CMD).intersects(Modifiers::CMD));
        assert!((!Modifiers::CMD).contains(Modifiers::SHIFT));
    }

    #[test]
    fn from_bits_truncate_drops_undefined_bits() {
        assert_eq!(
            Modifiers::from_bits_truncate(u32::MAX).bits(),
            Modifiers::ALL.bits()
        );
    }

    #[test]
    fn serde_roundtrip_is_transparent_u32() {
        let m = Modifiers::CMD_LEFT | Modifiers::SHIFT;
        let json = serde_json::to_string(&m).unwrap();
        assert_eq!(json, m.bits().to_string());
        assert_eq!(serde_json::from_str::<Modifiers>(&json).unwrap(), m);
    }

    #[test]
    fn parse_single_modifiers() {
        assert_eq!("Cmd".parse::<Modifiers>().unwrap(), Modifiers::CMD);
        assert_eq!("command".parse::<Modifiers>().unwrap(), Modifiers::CMD);
        assert_eq!("meta".parse::<Modifiers>().unwrap(), Modifiers::CMD);
        assert_eq!("super".parse::<Modifiers>().unwrap(), Modifiers::CMD);
        assert_eq!("win".parse::<Modifiers>().unwrap(), Modifiers::CMD);

        assert_eq!("Shift".parse::<Modifiers>().unwrap(), Modifiers::SHIFT);
        assert_eq!("SHIFT".parse::<Modifiers>().unwrap(), Modifiers::SHIFT);

        assert_eq!("Ctrl".parse::<Modifiers>().unwrap(), Modifiers::CTRL);
        assert_eq!("control".parse::<Modifiers>().unwrap(), Modifiers::CTRL);

        assert_eq!("Opt".parse::<Modifiers>().unwrap(), Modifiers::OPT);
        assert_eq!("option".parse::<Modifiers>().unwrap(), Modifiers::OPT);
        assert_eq!("alt".parse::<Modifiers>().unwrap(), Modifiers::OPT);

        assert_eq!("Fn".parse::<Modifiers>().unwrap(), Modifiers::FN);
        assert_eq!("function".parse::<Modifiers>().unwrap(), Modifiers::FN);
    }

    #[test]
    fn parse_primary_modifier_resolves_per_platform() {
        for alias in ["Mod", "CmdOrCtrl", "CommandOrControl", "cmdorcontrol"] {
            assert_eq!(alias.parse::<Modifiers>().unwrap(), Modifiers::primary());
        }
        #[cfg(target_os = "macos")]
        assert_eq!(Modifiers::primary(), Modifiers::CMD);
        #[cfg(not(target_os = "macos"))]
        assert_eq!(Modifiers::primary(), Modifiers::CTRL);
    }

    #[test]
    fn parse_side_specific_modifiers() {
        assert_eq!("CmdLeft".parse::<Modifiers>().unwrap(), Modifiers::CMD_LEFT);
        assert_eq!("LCmd".parse::<Modifiers>().unwrap(), Modifiers::CMD_LEFT);
        assert_eq!(
            "CmdRight".parse::<Modifiers>().unwrap(),
            Modifiers::CMD_RIGHT
        );
        assert_eq!("RCmd".parse::<Modifiers>().unwrap(), Modifiers::CMD_RIGHT);

        assert_eq!(
            "ShiftLeft".parse::<Modifiers>().unwrap(),
            Modifiers::SHIFT_LEFT
        );
        assert_eq!(
            "ShiftRight".parse::<Modifiers>().unwrap(),
            Modifiers::SHIFT_RIGHT
        );

        assert_eq!(
            "CtrlLeft".parse::<Modifiers>().unwrap(),
            Modifiers::CTRL_LEFT
        );
        assert_eq!(
            "CtrlRight".parse::<Modifiers>().unwrap(),
            Modifiers::CTRL_RIGHT
        );

        assert_eq!("OptLeft".parse::<Modifiers>().unwrap(), Modifiers::OPT_LEFT);
        assert_eq!(
            "AltRight".parse::<Modifiers>().unwrap(),
            Modifiers::OPT_RIGHT
        );
        assert_eq!("AltGr".parse::<Modifiers>().unwrap(), Modifiers::OPT_RIGHT);
    }

    #[test]
    fn parse_combined_modifiers() {
        assert_eq!(
            "Cmd+Shift".parse::<Modifiers>().unwrap(),
            Modifiers::CMD | Modifiers::SHIFT
        );
        assert_eq!(
            "Ctrl+Alt+Shift".parse::<Modifiers>().unwrap(),
            Modifiers::CTRL | Modifiers::OPT | Modifiers::SHIFT
        );
    }

    #[test]
    fn parse_empty_modifiers() {
        assert_eq!("".parse::<Modifiers>().unwrap(), Modifiers::empty());
        assert_eq!("  ".parse::<Modifiers>().unwrap(), Modifiers::empty());
    }

    #[test]
    fn parse_unknown_modifier_fails() {
        assert!("Unknown".parse::<Modifiers>().is_err());
        assert!("Cmd+Unknown".parse::<Modifiers>().is_err());
    }

    #[test]
    fn modifiers_display() {
        assert_eq!(format!("{}", Modifiers::CMD), "Cmd");
        assert_eq!(format!("{}", Modifiers::SHIFT), "Shift");
        assert_eq!(
            format!("{}", Modifiers::CMD | Modifiers::SHIFT),
            "Shift+Cmd"
        );
    }

    #[test]
    fn modifiers_display_side_specific() {
        assert_eq!(format!("{}", Modifiers::CMD_LEFT), "CmdLeft");
        assert_eq!(format!("{}", Modifiers::CMD_RIGHT), "CmdRight");
        assert_eq!(format!("{}", Modifiers::SHIFT_LEFT), "ShiftLeft");
        assert_eq!(format!("{}", Modifiers::CTRL_RIGHT), "CtrlRight");
        assert_eq!(format!("{}", Modifiers::OPT_LEFT), "OptLeft");
    }

    #[test]
    fn display_roundtrips_through_parse() {
        for m in [
            Modifiers::CMD,
            Modifiers::CMD | Modifiers::SHIFT,
            Modifiers::CTRL_LEFT,
            Modifiers::OPT_RIGHT | Modifiers::SHIFT,
            Modifiers::FN | Modifiers::CMD,
        ] {
            assert_eq!(m.to_string().parse::<Modifiers>().unwrap(), m);
        }
    }

    #[test]
    fn matches_compound_hotkey() {
        // Compound "Cmd" matches either side
        let hotkey = Modifiers::CMD;
        assert!(hotkey.matches(Modifiers::CMD_LEFT));
        assert!(hotkey.matches(Modifiers::CMD_RIGHT));
        assert!(hotkey.matches(Modifiers::CMD_LEFT | Modifiers::CMD_RIGHT));
        assert!(!hotkey.matches(Modifiers::empty()));
        assert!(!hotkey.matches(Modifiers::SHIFT_LEFT));
    }

    #[test]
    fn matches_side_specific_hotkey() {
        // Specific "CmdLeft" requires left
        let hotkey = Modifiers::CMD_LEFT;
        assert!(hotkey.matches(Modifiers::CMD_LEFT));
        assert!(!hotkey.matches(Modifiers::CMD_RIGHT));
        // Both sides pressed: left is still present, so it matches
        assert!(hotkey.matches(Modifiers::CMD_LEFT | Modifiers::CMD_RIGHT));
        assert!(!hotkey.matches(Modifiers::empty()));
    }

    #[test]
    fn matches_rejects_extra_groups() {
        // Hotkey is just Cmd, event has Cmd+Shift — should fail (extra group)
        let hotkey = Modifiers::CMD;
        assert!(!hotkey.matches(Modifiers::CMD_LEFT | Modifiers::SHIFT_LEFT));

        // Hotkey is CmdLeft+ShiftLeft, event is CmdLeft+ShiftLeft — OK
        let hotkey = Modifiers::CMD_LEFT | Modifiers::SHIFT_LEFT;
        assert!(hotkey.matches(Modifiers::CMD_LEFT | Modifiers::SHIFT_LEFT));
    }

    #[test]
    fn matches_fn_exact() {
        let hotkey = Modifiers::CMD | Modifiers::FN;
        assert!(hotkey.matches(Modifiers::CMD_LEFT | Modifiers::FN));
        assert!(!hotkey.matches(Modifiers::CMD_LEFT)); // missing FN

        let hotkey = Modifiers::CMD;
        assert!(!hotkey.matches(Modifiers::CMD_LEFT | Modifiers::FN)); // extra FN
    }

    #[test]
    fn matches_empty() {
        let hotkey = Modifiers::empty();
        assert!(hotkey.matches(Modifiers::empty()));
        assert!(!hotkey.matches(Modifiers::CMD_LEFT));
    }

    #[test]
    fn compound_equals_both_sides() {
        assert_eq!(Modifiers::CMD, Modifiers::CMD_LEFT | Modifiers::CMD_RIGHT);
        assert_eq!(
            Modifiers::SHIFT,
            Modifiers::SHIFT_LEFT | Modifiers::SHIFT_RIGHT
        );
        assert_eq!(
            Modifiers::CTRL,
            Modifiers::CTRL_LEFT | Modifiers::CTRL_RIGHT
        );
        assert_eq!(Modifiers::OPT, Modifiers::OPT_LEFT | Modifiers::OPT_RIGHT);
    }
}
