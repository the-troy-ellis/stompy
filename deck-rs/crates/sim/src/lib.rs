//! Stompy's simulation. Headless and deterministic: it takes an input snapshot
//! and a fixed `dt`, and tells the outside world what to play and say through
//! `Game::events`. This crate has no dependencies, so it cannot reach SDL, GL or
//! audio by construction.
// NaN-safe guards are written `!(x > 0.)` on purpose: a NaN fails them.
#![allow(
    clippy::too_many_arguments,
    clippy::new_without_default,
    clippy::neg_cmp_op_on_partial_ord,
    clippy::should_implement_trait
)]
pub mod data;
pub mod math;
pub mod rng;
pub mod spring;

pub mod ai;
pub mod beams;
pub mod combat;
pub mod effects;
pub mod feel;
pub mod fusion;
pub mod gait;
pub mod game;
pub mod geom;
pub mod jets;
pub mod mech;
pub mod melee;
pub mod missiles;
pub mod state;
pub mod terrain;
pub mod update;
pub mod voice;

pub use game::*;
