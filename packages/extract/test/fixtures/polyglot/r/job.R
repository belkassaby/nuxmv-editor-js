library(R6)

Job <- R6Class("Job",
  public = list(
    state = "queued",
    start = function() {
      if (self$state != "queued") return(invisible(self))
      self$state <- "running"
    },
    finish = function() {
      if (self$state == "running") self$state <- "done"
    },
    fail = function() {
      self$state <- "failed"
    },
    describe = function() {
      switch(self$state, queued = "waiting", running = "busy", retrying = "again")
    }
  )
)

read_first <- function(path) {
  con <- file(path, "r")
  line <- readLines(con, n = 1)
  close(con)
  line
}
