#include "RequestQueue.h"
namespace demo_hal {
bool canAccept(unsigned inFlight) {
    return inFlight < kBufferLimit;
}
}
