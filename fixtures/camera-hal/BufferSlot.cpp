#include "BufferSlot.h"
namespace demo_hal {
bool BufferSlot::reserve() {
    if (state_ != SlotState::Free) return false;
    state_ = SlotState::Queued;
    return true;
}
bool BufferSlot::submit() {
    if (state_ != SlotState::Queued) return false;
    state_ = SlotState::InFlight;
    return true;
}
bool BufferSlot::release() {
    if (state_ != SlotState::InFlight) return false;
    state_ = SlotState::Free;
    return true;
}
}
