use crate::config::AppearanceConfig;
use crate::models::agent::{AppearanceProfile, SlotCounts};

pub fn hash_seed(agent_id: &str) -> u32 {
    let mut h: u32 = 0;
    for byte in agent_id.bytes() {
        h = h.wrapping_mul(31).wrapping_add(byte as u32);
    }
    h
}

pub struct Mulberry32 {
    state: u32,
}

impl Mulberry32 {
    pub fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    pub fn next_f64(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6D2B79F5);
        let mut t = self.state ^ (self.state >> 15);
        t = t.wrapping_mul(1 | self.state);
        t = (t.wrapping_add(t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }

    pub fn next_index(&mut self, count: usize) -> usize {
        (self.next_f64() * count as f64) as usize
    }
}

pub fn generate_appearance(
    agent_id: &str,
    slot_counts: &SlotCounts,
    config: &AppearanceConfig,
) -> AppearanceProfile {
    let seed = hash_seed(agent_id);
    let mut rng = Mulberry32::new(seed);

    AppearanceProfile {
        body_index: rng.next_index(slot_counts.body.max(1)),
        hair_index: rng.next_index(slot_counts.hair.max(1)),
        outfit_index: rng.next_index(slot_counts.outfit.max(1)),
        accessory_index: rng.next_index(slot_counts.accessory + 1),
        face_index: rng.next_index(slot_counts.face.max(1)),
        hair_hue: rng.next_f64() * 360.0,
        outfit_hue: rng.next_f64() * 360.0,
        skin_hue: rng.next_f64() * 360.0,
        skin_lightness: config.skin_lightness_min
            + rng.next_f64() * (config.skin_lightness_max - config.skin_lightness_min),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deterministic_appearance() {
        let counts = SlotCounts {
            body: 3,
            hair: 6,
            outfit: 5,
            accessory: 3,
            face: 2,
        };
        let config = AppearanceConfig {
            skin_saturation_min: 25.0,
            skin_saturation_max: 54.0,
            skin_lightness_min: 75.0,
            skin_lightness_max: 89.0,
        };

        let a1 = generate_appearance("worker-01", &counts, &config);
        let a2 = generate_appearance("worker-01", &counts, &config);

        // 동일 agent_id -> 동일 외형
        assert_eq!(a1.body_index, a2.body_index);
        assert_eq!(a1.hair_index, a2.hair_index);
        assert_eq!(a1.hair_hue, a2.hair_hue);
    }

    #[test]
    fn test_different_agents_different_appearance() {
        let counts = SlotCounts {
            body: 3,
            hair: 6,
            outfit: 5,
            accessory: 3,
            face: 2,
        };
        let config = AppearanceConfig {
            skin_saturation_min: 25.0,
            skin_saturation_max: 54.0,
            skin_lightness_min: 75.0,
            skin_lightness_max: 89.0,
        };

        let a1 = generate_appearance("worker-01", &counts, &config);
        let a2 = generate_appearance("worker-02", &counts, &config);

        // 다른 agent_id -> 다른 seed -> 높은 확률로 다른 외형
        let same = a1.body_index == a2.body_index
            && a1.hair_index == a2.hair_index
            && a1.outfit_index == a2.outfit_index;
        assert!(!same, "different agents should have different appearances");
    }

    #[test]
    fn test_skin_lightness_in_range() {
        let counts = SlotCounts {
            body: 3,
            hair: 6,
            outfit: 5,
            accessory: 3,
            face: 2,
        };
        let config = AppearanceConfig {
            skin_saturation_min: 25.0,
            skin_saturation_max: 54.0,
            skin_lightness_min: 75.0,
            skin_lightness_max: 89.0,
        };

        for i in 0..100 {
            let a = generate_appearance(&format!("agent-{i}"), &counts, &config);
            assert!(
                a.skin_lightness >= 75.0 && a.skin_lightness <= 89.0,
                "skin_lightness {} out of range for agent-{}",
                a.skin_lightness,
                i
            );
        }
    }
}
