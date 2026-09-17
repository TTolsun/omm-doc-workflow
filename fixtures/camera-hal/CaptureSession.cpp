#include "CaptureSession.h"
namespace demo_hal {
bool CaptureSession::submit() {
    if (!canAccept(inFlight_)) return false;
    for (BufferSlot& slot : slots_) {
        if (!slot.reserve()) continue;
        slot.submit();
        ++inFlight_;
        return true;
    }
    return false;
}
void CaptureSession::complete(unsigned slot) {
    if (slot >= kBufferLimit) return;
    if (slots_[slot].release()) --inFlight_;
}
}
