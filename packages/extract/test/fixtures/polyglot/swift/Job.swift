import Foundation

enum State { case idle, running, done, failed, retrying }

class Job {
    var state: State = .idle

    func start() {
        guard state == .idle else { return }
        state = .running
    }

    func finish() {
        if state == .running {
            state = .done
        }
    }

    func fail() {
        state = .failed
    }
}
