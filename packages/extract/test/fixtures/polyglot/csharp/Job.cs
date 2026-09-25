using System;
using System.Threading;

enum State { Idle, Running, Done, Failed, Retrying }

class Job {
    private State state = State.Idle;
    private Timer timer;

    public void Start() {
        if (state != State.Idle) return;
        state = State.Running;
        timer = new Timer(_ => Console.WriteLine("tick"), null, 0, 1000);
    }

    public void Finish() {
        if (state == State.Running) state = State.Done;
    }

    public void Fail() {
        state = State.Failed;
    }

    public string Describe() {
        switch (state) {
            case State.Idle: return "waiting";
            case State.Running: return "busy";
            case State.Done: return "finished";
        }
        return "";
    }
}
