#include <stdlib.h>
#include "job.h"

typedef enum { IDLE, RUNNING, DONE, FAILED, RETRYING } job_state;

static job_state state = IDLE;

void job_start(void) {
    if (state != IDLE) return;
    state = RUNNING;
}

void job_finish(void) {
    if (state == RUNNING) state = DONE;
}

void job_fail(void) {
    state = FAILED;
}

const char *job_describe(void) {
    switch (state) {
    case IDLE: return "waiting";
    case RUNNING: return "busy";
    case DONE: return "finished";
    }
    return "";
}

int job_process(int n) {
    char *buffer = malloc(n);
    if (buffer == NULL) return -1;
    int ok = n > 0;
    if (n > 100) return -2;
    free(buffer);
    return ok;
}
