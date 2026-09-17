#pragma once
// Synthetic documentation fixture; this is not a vendor HAL implementation.
#include "BufferSlot.h"
#include "RequestQueue.h"
namespace demo_hal {
class CaptureSession {
public:
    // Returns false when canAccept() rejects the request or no slot is Free.
    bool submit();
    void complete(unsigned slot);
    unsigned inFlight() const { return inFlight_; }
private:
    BufferSlot slots_[kBufferLimit];
    unsigned inFlight_ = 0;
};
}
