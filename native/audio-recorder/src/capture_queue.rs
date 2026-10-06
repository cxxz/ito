use crossbeam_channel::Sender;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};

/// Real-time callbacks only use atomics and try_send; reporting stays on the writer.
pub struct QueueBudget {
    max_samples: usize,
    queued_samples: AtomicUsize,
    dropped_frames: AtomicU64,
    dropped_samples: AtomicU64,
}

impl QueueBudget {
    pub fn new(max_samples: usize) -> Self {
        Self {
            max_samples,
            queued_samples: AtomicUsize::new(0),
            dropped_frames: AtomicU64::new(0),
            dropped_samples: AtomicU64::new(0),
        }
    }

    pub fn overloaded(&self) -> bool {
        self.dropped_frames.load(Ordering::Relaxed) > 0
    }

    pub fn drop_frame(&self, samples: usize) {
        self.dropped_samples
            .fetch_add(samples as u64, Ordering::Relaxed);
        self.dropped_frames.fetch_add(1, Ordering::Relaxed);
    }

    pub fn enqueue(&self, tx: &Sender<Vec<f32>>, frame: Vec<f32>) {
        let samples = frame.len();
        let before = self.queued_samples.fetch_add(samples, Ordering::Relaxed);
        if before.saturating_add(samples) > self.max_samples
            || self.overloaded()
            || tx.try_send(frame).is_err()
        {
            self.release(samples);
            self.drop_frame(samples);
        }
    }

    pub fn release(&self, samples: usize) {
        self.queued_samples.fetch_sub(samples, Ordering::Relaxed);
    }

    pub fn dropped(&self) -> (u64, u64) {
        (
            self.dropped_frames.load(Ordering::Relaxed),
            self.dropped_samples.load(Ordering::Relaxed),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_samples_even_when_the_frame_queue_has_room() {
        let budget = QueueBudget::new(4);
        let (tx, rx) = crossbeam_channel::bounded(8);
        budget.enqueue(&tx, vec![0.0; 4]);
        budget.enqueue(&tx, vec![0.0; 2]);
        assert_eq!(rx.len(), 1);
        assert_eq!(budget.dropped(), (1, 2));
        assert!(budget.overloaded());
    }

    #[test]
    fn records_full_frame_queues_and_stops_accepting_audio() {
        let budget = QueueBudget::new(100);
        let (tx, rx) = crossbeam_channel::bounded(1);
        budget.enqueue(&tx, vec![0.0; 3]);
        budget.enqueue(&tx, vec![0.0; 4]);
        budget.release(rx.recv().unwrap().len());
        budget.enqueue(&tx, vec![0.0; 5]);
        assert!(rx.is_empty());
        assert_eq!(budget.dropped(), (2, 9));
    }

    #[test]
    fn consuming_a_frame_releases_its_sample_budget() {
        let budget = QueueBudget::new(4);
        let (tx, rx) = crossbeam_channel::bounded(1);
        budget.enqueue(&tx, vec![0.0; 4]);
        budget.release(rx.recv().unwrap().len());
        budget.enqueue(&tx, vec![0.0; 4]);
        assert_eq!(rx.len(), 1);
        assert!(!budget.overloaded());
    }
}
