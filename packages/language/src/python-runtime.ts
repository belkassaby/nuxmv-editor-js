/**
 * Static part of the generated Python module: the runtime shared by every
 * diagram. The generator prepends the diagram-specific tables and appends the
 * FSM class. Kept as raw text so that Python escapes survive unchanged.
 */
export const PYTHON_RUNTIME = String.raw`

# --------------------------------------------------------------------------
# Runtime (generated, no third-party dependency; anywidget is optional)
# --------------------------------------------------------------------------


class InvalidTransition(Exception):
    """Raised when an event is not allowed in the current state of the verified model."""


class PropertyViolation(Exception):
    """Raised (in strict mode) when a runtime monitor detects a violated property."""


class _Monitor:
    """Incremental monitor of G(phi) where phi only looks at the present and the past."""

    def __init__(self, name, kind, formula, slots, inits, check):
        self.name, self.kind, self.formula = name, kind, formula
        self._slots, self._inits, self._check = slots, inits, check
        self.reset()

    def reset(self):
        self._pre = list(self._inits)
        self.violated_at = None

    def step(self, v, index):
        n = [False] * self._slots
        ok = bool(self._check(v, self._pre, n))
        self._pre = n
        if not ok and self.violated_at is None:
            self.violated_at = index
        return ok


def _svg(diagram, current, visited):
    """Static SVG rendering of the diagram, current state highlighted (used by _repr_svg_)."""
    import html
    import math

    states = diagram["states"]
    pos = {}
    missing = [s for s in states if s.get("x") is None]
    for i, s in enumerate(states):
        if s.get("x") is not None:
            pos[s["name"]] = (float(s["x"]), float(s["y"]))
    for i, s in enumerate(missing):
        a = 2 * math.pi * i / max(1, len(missing))
        pos[s["name"]] = (400 + 300 * math.cos(a), 300 + 220 * math.sin(a))

    def size(s):
        text = s["name"] + ("\n" + s["label"] if s.get("label") else "")
        width = max(64, max(len(line) for line in text.split("\n")) * 7.8 + 24)
        return width / 2, 32

    radii = {s["name"]: size(s) for s in states}
    xs = [p[0] for p in pos.values()] or [0]
    ys = [p[1] for p in pos.values()] or [0]
    wmax = max(r[0] for r in radii.values()) if radii else 40
    x0, y0 = min(xs) - wmax - 40, min(ys) - 90
    x1, y1 = max(xs) + wmax + 40, max(ys) + 70
    out = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="%.0f %.0f %.0f %.0f" width="%.0f" '
        'font-family="Inter, system-ui, sans-serif" style="max-width:100%%;height:auto">'
        % (x0, y0, x1 - x0, y1 - y0, min(900, x1 - x0)),
        '<defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" '
        'orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#7d8fa3"/></marker>'
        '<marker id="arrow-hot" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" '
        'orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#f59f00"/></marker></defs>',
        '<rect x="%.0f" y="%.0f" width="%.0f" height="%.0f" fill="#fbfcfe"/>' % (x0, y0, x1 - x0, y1 - y0),
    ]
    pairs = {(t["source"], t["target"]) for t in diagram["transitions"]}
    last = visited[-2:] if len(visited) >= 2 else []
    for t in diagram["transitions"]:
        s, d = t["source"], t["target"]
        hot = len(last) == 2 and last[0] == s and last[1] == d
        color, marker, width = ("#f59f00", "arrow-hot", 3) if hot else ("#7d8fa3", "arrow", 1.5)
        (sx, sy), (dx, dy) = pos[s], pos[d]
        if s == d:
            rx, ry = radii[s]
            path = "M %.1f %.1f C %.1f %.1f %.1f %.1f %.1f %.1f" % (
                sx - 12, sy - ry, sx - 40, sy - ry - 55, sx + 40, sy - ry - 55, sx + 12, sy - ry)
            out.append('<path d="%s" fill="none" stroke="%s" stroke-width="%s" marker-end="url(#%s)"/>' % (path, color, width, marker))
            continue
        ang = math.atan2(dy - sy, dx - sx)
        def edge_point(cx, cy, r, a):
            rx, ry = r
            k = 1 / math.sqrt((math.cos(a) / rx) ** 2 + (math.sin(a) / ry) ** 2)
            return cx + k * math.cos(a), cy + k * math.sin(a)
        ax, ay = edge_point(sx, sy, radii[s], ang)
        bx, by = edge_point(dx, dy, radii[d], ang + math.pi)
        bend = 22 if (d, s) in pairs else 0
        mx, my = (ax + bx) / 2 - bend * math.sin(ang), (ay + by) / 2 + bend * math.cos(ang)
        out.append('<path d="M %.1f %.1f Q %.1f %.1f %.1f %.1f" fill="none" stroke="%s" stroke-width="%s" marker-end="url(#%s)"/>'
                   % (ax, ay, mx, my, bx, by, color, width, marker))
        if t.get("label"):
            out.append('<text x="%.1f" y="%.1f" font-size="10" fill="#5b6b7c" text-anchor="middle">%s</text>'
                       % (mx, my - 4, html.escape(t["label"])))
    for s in states:
        (x, y), (rx, ry) = pos[s["name"]], radii[s["name"]]
        is_current = s["name"] == current
        fill = "#f59f00" if is_current else ("#fde9c9" if s["name"] in visited else "#e8f1fb")
        stroke = "#b35c00" if is_current else ("#2f6fdf" if s.get("initial") else "#4a7fb5")
        width = 4 if is_current or s.get("initial") else 2
        out.append('<ellipse cx="%.1f" cy="%.1f" rx="%.1f" ry="%.1f" fill="%s" stroke="%s" stroke-width="%s"/>'
                   % (x, y, rx, ry, fill, stroke, width))
        lines = [s["name"]] + ([s["label"]] if s.get("label") else [])
        for i, line in enumerate(lines):
            out.append('<text x="%.1f" y="%.1f" font-size="12" font-weight="600" fill="#1b2733" '
                       'text-anchor="middle" dominant-baseline="central">%s</text>'
                       % (x, y + (i - (len(lines) - 1) / 2) * 14, html.escape(line)))
    out.append("</svg>")
    return "".join(out)


_WIDGET_ESM = r"""
import cytoscape from "https://esm.sh/cytoscape@3.34.3";

function render({ model, el }) {
  const box = document.createElement("div");
  box.style.cssText = "height:" + (model.get("height") || 420) + "px;border:1px solid #d9dfe7;border-radius:8px;background:#fbfcfe";
  const caption = document.createElement("div");
  caption.style.cssText = "font:13px system-ui,sans-serif;margin:6px 2px;color:#1b2733";
  el.append(caption, box);
  const d = model.get("diagram");
  const hasPos = d.states.every(s => s.x !== null && s.x !== undefined);
  const cy = cytoscape({
    container: box,
    elements: [
      ...d.states.map(s => ({ data: { id: s.name, label: s.label ? s.name + "\n" + s.label : s.name, initial: s.initial ? 1 : 0 },
                               position: hasPos ? { x: s.x, y: s.y } : undefined })),
      ...d.transitions.map((t, i) => ({ data: { id: "t" + i, source: t.source, target: t.target, label: t.label || "" } })),
    ],
    layout: hasPos ? { name: "preset", padding: 30 } : { name: "breadthfirst", directed: true, padding: 30 },
    style: [
      { selector: "node", style: { label: "data(label)", "text-wrap": "wrap", "text-valign": "center", "font-size": 12,
        "font-weight": 600, width: n => Math.max(64, Math.max(...n.data("label").split("\n").map(l => l.length)) * 7.8 + 24),
        height: 60, "background-color": "#e8f1fb", "border-width": 2, "border-color": "#4a7fb5", color: "#1b2733" } },
      { selector: "node[?initial]", style: { "border-width": 5, "border-style": "double", "border-color": "#2f6fdf" } },
      { selector: "node.visited", style: { "background-color": "#fde9c9" } },
      { selector: "node.current", style: { "background-color": "#f59f00", "border-color": "#b35c00", "border-width": 4 } },
      { selector: "node.next", style: { "border-color": "#2b8a3e", "border-style": "dotted", "border-width": 4 } },
      { selector: "edge", style: { "curve-style": "bezier", "target-arrow-shape": "triangle", width: 2, "line-color": "#7d8fa3",
        "target-arrow-color": "#7d8fa3", label: "data(label)", "font-size": 10, color: "#5b6b7c",
        "text-background-color": "#fbfcfe", "text-background-opacity": 0.85 } },
      { selector: "edge.last", style: { width: 4, "line-color": "#f59f00", "target-arrow-color": "#f59f00" } },
    ],
  });
  function update() {
    const state = model.get("state");
    const history = model.get("history") || [];
    cy.elements().removeClass("current visited next last");
    history.forEach(s => cy.getElementById(s).addClass("visited"));
    cy.getElementById(state).addClass("current");
    (model.get("allowed") || []).forEach(s => cy.getElementById(s).addClass("next"));
    if (history.length >= 2) {
      const a = history[history.length - 2], b = history[history.length - 1];
      cy.edges('[source = "' + a + '"][target = "' + b + '"]').addClass("last");
    }
    const v = model.get("violations") || [];
    caption.innerHTML = "<b>" + d.name + "</b> &middot; state <code>" + state + "</code> &middot; step " + (history.length - 1) +
      (model.get("last_event") ? " &middot; last event <code>" + model.get("last_event") + "</code>" : "") +
      (v.length ? ' &middot; <span style="color:#c92a2a">violated: ' + v.join(", ") + "</span>" : "");
  }
  model.on("change:state", update);
  model.on("change:history", update);
  model.on("change:violations", update);
  update();
  setTimeout(() => { cy.resize(); cy.fit(undefined, 30); }, 50);
  return () => cy.destroy();
}
export default { render };
"""


def _make_widget(fsm, height=420):
    try:
        import anywidget
        import traitlets
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise ImportError("The live diagram needs anywidget: pip install anywidget") from exc

    class StateMachineWidget(anywidget.AnyWidget):
        _esm = _WIDGET_ESM
        diagram = traitlets.Dict().tag(sync=True)
        state = traitlets.Unicode().tag(sync=True)
        history = traitlets.List().tag(sync=True)
        allowed = traitlets.List().tag(sync=True)
        last_event = traitlets.Unicode("").tag(sync=True)
        violations = traitlets.List().tag(sync=True)
        height = traitlets.Int(420).tag(sync=True)

    w = StateMachineWidget(diagram=DIAGRAM, height=height)

    def sync(fsm_, record=None):
        # The view redraws on "state", so everything it displays is set first.
        w.last_event = record["event"] if record else ""
        w.violations = [m.name for m in fsm_.monitors if m.violated_at is not None]
        w.allowed = sorted({TRANSITIONS[(fsm_.state, e)].value for e in fsm_.allowed_events()})
        w.history = [s.value for s in fsm_.visited]
        w.state = fsm_.state.value

    sync(fsm)
    fsm.subscribe(sync)
    return w


class EditorLink:
    """Streams every state change to a running nuxmv-editor (POST /api/live/<channel>).

    Open the Trace tab of the editor, choose "Live from Python" with the same channel and
    the diagram highlights the state your code is in. Network errors never interrupt the FSM.
    """

    def __init__(self, url="http://127.0.0.1:3000", channel="default", timeout=2.0):
        import re
        if not re.fullmatch(r"[\w-]{1,64}", channel):
            raise ValueError("channel: 1-64 letters, digits, _ or -")
        self.endpoint = url.rstrip("/") + "/api/live/" + channel
        self.timeout = timeout
        self.warned = False

    def __call__(self, fsm, record=None):
        import json
        import threading
        import urllib.request

        payload = {
            "diagram": DIAGRAM["name"],
            "state": fsm.state.value,
            "step": len(fsm.history),
            "event": record["event"] if record else None,
            "values": {k: v for k, v in fsm.values.items() if k != "state"},
            "allowed": [e.value for e in fsm.allowed_events()],
            "violations": [m.name for m in fsm.monitors if m.violated_at is not None],
        }

        def post():
            try:
                req = urllib.request.Request(self.endpoint, data=json.dumps(payload).encode(),
                                             headers={"content-type": "application/json"}, method="POST")
                urllib.request.urlopen(req, timeout=self.timeout).read()
            except Exception as exc:  # the FSM must not depend on the editor being up
                if not self.warned:
                    self.warned = True
                    print("EditorLink: could not reach %s (%s)" % (self.endpoint, exc))

        threading.Thread(target=post, daemon=True).start()


class StateMachine:
    """Event-driven runtime of a verified diagram.

    * send(event) moves along a transition of the verified model or raises InvalidTransition;
      the caller (LLM, tool, human, test) chooses the event, the machine only allows legal ones.
    * allowed_events() lists the legal events, e.g. to constrain an LLM's choice.
    * on_enter_<state>(self, event, data) / on_exit_<state>(...) hooks run on each transition.
    * Runtime monitors re-check the monitorable properties on every step.
    """

    def __init__(self, initial=None, *, strict=True, listeners=()):
        start = State(initial) if initial is not None else INITIAL_STATES[0]
        if start not in INITIAL_STATES:
            raise InvalidTransition("%s is not an initial state (initial: %s)" % (start.value, ", ".join(s.value for s in INITIAL_STATES)))
        self.strict = strict
        self.state = start
        self.history = []
        self.visited = [start]
        self.free_values = {}
        self._listeners = list(listeners)
        self.monitors = [_Monitor(*m) for m in MONITOR_SPECS]
        self._check_monitors(record=None)
        self._notify(None)

    # -- queries -----------------------------------------------------------
    @property
    def values(self):
        """Atoms / attribute values of the current state, as in the diagram (L(s))."""
        v = dict(LABELS[self.state])
        for name, value in self.free_values.items():
            if v.get(name) is None:
                v[name] = value
        v["state"] = self.state.value
        return v

    def allowed_events(self):
        return [e for (s, e) in TRANSITIONS if s == self.state]

    def can(self, event):
        try:
            return (self.state, _to_event(event)) in TRANSITIONS
        except InvalidTransition:
            return False

    @property
    def is_terminal(self):
        return self.state in TERMINAL_STATES

    # -- transitions ---------------------------------------------------------
    def send(self, event, values=None, **data):
        """Fire an event. values: attributes left free (any) in the target state."""
        event = _to_event(event)
        key = (self.state, event)
        if key not in TRANSITIONS:
            raise InvalidTransition("%s is not allowed in state %s (allowed: %s)" % (
                event.value, self.state.value, ", ".join(e.value for e in self.allowed_events()) or "none"))
        source, target = self.state, TRANSITIONS[key]
        self._set_free_values(target, values or {})
        getattr(self, "on_exit_" + source.value, _noop)(event, data)
        self.state = target
        self.visited.append(target)
        record = {"step": len(self.history) + 1, "event": event.value, "source": source.value, "target": target.value, "data": data}
        self.history.append(record)
        self._check_monitors(record)
        getattr(self, "on_enter_" + target.value, _noop)(event, data)
        self._notify(record)
        return target

    def replay(self, events):
        for e in events:
            self.send(e)
        return self

    def _set_free_values(self, target, values):
        self.free_values = {}
        for name, value in values.items():
            if name not in DOMAINS:
                raise InvalidTransition("unknown attribute %r" % (name,))
            if LABELS[target].get(name) is not None:
                raise InvalidTransition("%s is fixed to %r in state %s" % (name, LABELS[target][name], target.value))
            if value not in DOMAINS[name]:
                raise InvalidTransition("%r is not in the domain of %s" % (value, name))
            self.free_values[name] = value

    # -- monitors and listeners ---------------------------------------------
    def _check_monitors(self, record):
        v = self.values
        broken = [m for m in self.monitors if not m.step(v, len(self.history))]
        if broken and self.strict:
            names = ", ".join("%s %s (%s)" % (m.kind, m.name, m.formula) for m in broken)
            raise PropertyViolation("step %d, state %s: %s" % (len(self.history), self.state.value, names))

    def subscribe(self, listener):
        """listener(fsm, record) is called after every transition (record is None initially)."""
        self._listeners.append(listener)
        return listener

    def _notify(self, record):
        for listener in list(self._listeners):
            listener(self, record)

    # -- display --------------------------------------------------------------
    def widget(self, height=420):
        """Live diagram for Jupyter (needs anywidget); follows every transition."""
        return _make_widget(self, height)

    def link_editor(self, url="http://127.0.0.1:3000", channel="default"):
        """Stream state changes to a running nuxmv-editor."""
        link = EditorLink(url, channel)
        self.subscribe(link)
        link(self, None)
        return link

    def _repr_svg_(self):
        return _svg(DIAGRAM, self.state.value, [s.value for s in self.visited])

    def __repr__(self):
        return "<%s state=%s step=%d>" % (type(self).__name__, self.state.value, len(self.history))


def _noop(*_args, **_kwargs):
    return None


def _to_event(event):
    """Accepts an Event, its name, or the transition label as written in the diagram."""
    import re
    if isinstance(event, Event):
        return event
    try:
        return Event(event)
    except ValueError:
        pass
    words = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", str(event))
    name = "_".join(w for w in re.split(r"[^A-Za-z0-9]+", words) if w).upper()
    try:
        return Event(name)
    except ValueError:
        raise InvalidTransition("unknown event %r" % (event,)) from None
`;
