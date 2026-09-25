from enum import Enum


class JobState(Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    RETRYING = "retrying"


class Job:
    def __init__(self):
        self.state = JobState.QUEUED

    def start(self):
        if self.state == JobState.QUEUED:
            self.state = JobState.RUNNING

    def finish(self):
        if self.state != JobState.RUNNING:
            return
        self.state = JobState.DONE

    def fail(self):
        self.state = JobState.FAILED

    def describe(self):
        match self.state:
            case JobState.QUEUED:
                return "waiting"
            case JobState.RUNNING:
                return "busy"
            case JobState.DONE:
                return "finished"


def export(path, text):
    handle = open(path, "w")
    handle.write(text)
    handle.close()
