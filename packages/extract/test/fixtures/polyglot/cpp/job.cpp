#include <string>

enum class State { Idle, Running, Done, Failed, Retrying };

class Job {
 public:
  void start() {
    if (state_ != State::Idle) return;
    state_ = State::Running;
  }
  void finish() {
    if (state_ == State::Running) state_ = State::Done;
  }
  void fail() { state_ = State::Failed; }
  std::string describe() const {
    switch (state_) {
      case State::Idle: return "waiting";
      case State::Running: return "busy";
      case State::Done: return "finished";
    }
    return "";
  }

 private:
  State state_ = State::Idle;
};
