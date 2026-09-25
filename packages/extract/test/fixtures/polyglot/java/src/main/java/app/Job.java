package app;

import java.io.FileReader;
import java.io.IOException;

enum State { IDLE, RUNNING, DONE, FAILED, RETRYING }

public class Job {
    private State state = State.IDLE;

    public void start() {
        if (state != State.IDLE) return;
        state = State.RUNNING;
    }

    public void finish() {
        if (this.state == State.RUNNING) {
            this.state = State.DONE;
        }
    }

    public void fail() {
        state = State.FAILED;
    }

    public String describe() {
        switch (state) {
            case IDLE: return "waiting";
            case RUNNING: return "busy";
            case DONE: return "finished";
        }
        return "";
    }

    public String firstLine(String path) throws IOException {
        FileReader reader = new FileReader(path);
        int c = reader.read();
        reader.close();
        return String.valueOf(c);
    }
}
