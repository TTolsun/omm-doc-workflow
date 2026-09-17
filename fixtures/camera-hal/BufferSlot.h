#pragma once
// Synthetic documentation fixture; this is not a vendor HAL implementation.
namespace demo_hal {
enum class SlotState { Free, Queued, InFlight };
class BufferSlot {
public:
    SlotState state() const { return state_; }
    bool reserve();   // Free -> Queued
    bool submit();    // Queued -> InFlight
    bool release();   // InFlight -> Free
private:
    SlotState state_ = SlotState::Free;
};
}
