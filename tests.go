package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// tests.go — runner-agnóstico de testes (vitest, go test, cargo test).
//
// Diferente de tasks.go (que abre uma sessão PTY no Terminal), aqui
// rodamos os comandos como processos filhos comuns, parseamos a saída
// estruturada de cada runner e empurramos updates por evento — o frontend
// monta uma UI de progresso por teste em tempo real.

// ── Tipos públicos ───────────────────────────────────────────────────────────

type TestRunnerKind string

const (
	TestRunnerVitest TestRunnerKind = "vitest"
	TestRunnerGo     TestRunnerKind = "go"
	TestRunnerCargo  TestRunnerKind = "cargo"
)

type TestRunner struct {
	ID     string         `json:"id"`     // ex: "vitest", "vitest:frontend"
	Kind   TestRunnerKind `json:"kind"`   // vitest | go | cargo
	Label  string         `json:"label"`  // texto curto
	Cwd    string         `json:"cwd"`    // diretório de execução
	Detail string         `json:"detail"` // arquivo-fonte da detecção
	Cmd    string         `json:"cmd"`    // comando reconstruível (apenas info)
}

type TestNodeStatus string

const (
	TestStatusPending TestNodeStatus = "pending"
	TestStatusRunning TestNodeStatus = "running"
	TestStatusPassed  TestNodeStatus = "passed"
	TestStatusFailed  TestNodeStatus = "failed"
	TestStatusSkipped TestNodeStatus = "skipped"
)

type TestNode struct {
	ID         string         `json:"id"`         // identificador estável
	ParentID   string         `json:"parentId"`   // "" para raízes
	Name       string         `json:"name"`       // nome exibido
	File       string         `json:"file"`       // origem (pkg p/ go, file p/ vitest)
	IsSuite    bool           `json:"isSuite"`    // true → agrupa filhos
	Status     TestNodeStatus `json:"status"`     // estado atual
	DurationMs int64          `json:"durationMs"` // ms quando concluído
	Failure    string         `json:"failure"`    // mensagem de falha
}

type TestRunSummary struct {
	RunnerID   string `json:"runnerId"`
	Status     string `json:"status"` // running | completed | cancelled | error
	StartedAt  int64  `json:"startedAt"`
	FinishedAt int64  `json:"finishedAt"`
	Passed     int    `json:"passed"`
	Failed     int    `json:"failed"`
	Skipped    int    `json:"skipped"`
	Total      int    `json:"total"`
	Error      string `json:"error,omitempty"`
}

// Eventos emitidos pro frontend.
const (
	evtTestsRunners = "tests.runners"   // {runners: []TestRunner}
	evtTestsStart   = "tests.run.start" // {summary}
	evtTestsTree    = "tests.tree"      // {runnerId, nodes} — substitui o snapshot
	evtTestsUpdate  = "tests.update"    // {runnerId, node}
	evtTestsLog     = "tests.log"       // {runnerId, chunk}
	evtTestsDone    = "tests.run.done"  // {summary}
)

// ── Service ──────────────────────────────────────────────────────────────────

type Tests struct {
	ctx context.Context

	mu      sync.Mutex
	workdir string

	runMu    sync.Mutex
	cancel   context.CancelFunc // cancela run atual
	current  *TestRunSummary
	nodes    map[string]TestNode // snapshot do run atual
	nodeKeys []string            // ordem estável p/ tree dump
	runID    int64               // monotônico — invalida emits tardios após cancel
}

func NewTests() *Tests {
	return &Tests{}
}

func (t *Tests) startup(ctx context.Context) {
	t.ctx = ctx
}

func (t *Tests) SetWorkdir(path string) {
	t.mu.Lock()
	t.workdir = path
	t.mu.Unlock()
}

// DetectRunners varre o workdir e devolve a lista de runners disponíveis.
func (t *Tests) DetectRunners() ([]TestRunner, error) {
	t.mu.Lock()
	root := t.workdir
	t.mu.Unlock()
	if root == "" {
		return []TestRunner{}, nil
	}
	out := make([]TestRunner, 0, 4)
	out = append(out, detectVitest(root)...)
	out = append(out, detectGoTest(root)...)
	out = append(out, detectCargoTest(root)...)
	emit(evtTestsRunners, map[string]any{"runners": out})
	return out, nil
}

// RunTests inicia uma execução para o runner escolhido. Cancela qualquer run anterior.
func (t *Tests) RunTests(runnerID string) error {
	runners, _ := t.DetectRunners()
	var def *TestRunner
	for i := range runners {
		if runners[i].ID == runnerID {
			def = &runners[i]
			break
		}
	}
	if def == nil {
		return fmt.Errorf("runner não encontrado: %s", runnerID)
	}

	t.runMu.Lock()
	if t.cancel != nil {
		t.cancel()
	}
	rid := atomic.AddInt64(&t.runID, 1)
	ctx, cancel := context.WithCancel(t.ctx)
	t.cancel = cancel
	t.nodes = map[string]TestNode{}
	t.nodeKeys = nil
	now := time.Now().UnixMilli()
	t.current = &TestRunSummary{
		RunnerID:  def.ID,
		Status:    "running",
		StartedAt: now,
	}
	summary := *t.current
	t.runMu.Unlock()

	emit(evtTestsStart, map[string]any{"summary": summary})
	emit(evtTestsTree, map[string]any{"runnerId": def.ID, "nodes": []TestNode{}})

	go t.runLoop(ctx, rid, *def)
	return nil
}

// CancelRun cancela a run em andamento (se houver).
func (t *Tests) CancelRun() error {
	t.runMu.Lock()
	defer t.runMu.Unlock()
	if t.cancel == nil {
		return nil
	}
	t.cancel()
	t.cancel = nil
	return nil
}

// ── Detecção por runner ──────────────────────────────────────────────────────

func detectVitest(root string) []TestRunner {
	out := []TestRunner{}
	// Scan na raiz e em até 1 nível de profundidade (frontend/, app/, etc).
	candidates := []string{root}
	if entries, err := os.ReadDir(root); err == nil {
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			name := e.Name()
			if strings.HasPrefix(name, ".") || name == "node_modules" || name == "dist" || name == "build" {
				continue
			}
			candidates = append(candidates, filepath.Join(root, name))
		}
	}
	seen := map[string]bool{}
	for _, dir := range candidates {
		if seen[dir] {
			continue
		}
		seen[dir] = true
		pkgPath := filepath.Join(dir, "package.json")
		raw, err := os.ReadFile(pkgPath)
		if err != nil {
			continue
		}
		if !packageHasVitest(raw) {
			continue
		}
		runner := detectNodeRunner(dir)
		id := "vitest"
		label := "vitest"
		if dir != root {
			rel, _ := filepath.Rel(root, dir)
			id = "vitest:" + rel
			label = "vitest · " + rel
		}
		out = append(out, TestRunner{
			ID:     id,
			Kind:   TestRunnerVitest,
			Label:  label,
			Cwd:    dir,
			Detail: filepath.Join(filepath.Base(dir), "package.json"),
			Cmd:    runner + " x vitest run --reporter=tap",
		})
	}
	return out
}

func packageHasVitest(raw []byte) bool {
	var pkg struct {
		Scripts         map[string]string `json:"scripts"`
		Dependencies    map[string]string `json:"dependencies"`
		DevDependencies map[string]string `json:"devDependencies"`
	}
	if err := json.Unmarshal(raw, &pkg); err != nil {
		return false
	}
	if _, ok := pkg.DevDependencies["vitest"]; ok {
		return true
	}
	if _, ok := pkg.Dependencies["vitest"]; ok {
		return true
	}
	for _, body := range pkg.Scripts {
		if strings.Contains(body, "vitest") {
			return true
		}
	}
	return false
}

func detectGoTest(root string) []TestRunner {
	if _, err := os.Stat(filepath.Join(root, "go.mod")); err != nil {
		return nil
	}
	return []TestRunner{{
		ID:     "go",
		Kind:   TestRunnerGo,
		Label:  "go test",
		Cwd:    root,
		Detail: "go.mod",
		Cmd:    "go test -json ./...",
	}}
}

func detectCargoTest(root string) []TestRunner {
	if _, err := os.Stat(filepath.Join(root, "Cargo.toml")); err != nil {
		return nil
	}
	return []TestRunner{{
		ID:     "cargo",
		Kind:   TestRunnerCargo,
		Label:  "cargo test",
		Cwd:    root,
		Detail: "Cargo.toml",
		Cmd:    "cargo test",
	}}
}

// ── Loop de execução ─────────────────────────────────────────────────────────

func (t *Tests) runLoop(ctx context.Context, rid int64, def TestRunner) {
	cmd, err := buildCommand(ctx, def)
	if err != nil {
		t.finishRun(rid, "error", err)
		return
	}
	cmd.Dir = def.Cwd
	cmd.Env = append(os.Environ(), "FORCE_COLOR=0", "NO_COLOR=1", "CI=1")

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.finishRun(rid, "error", err)
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		t.finishRun(rid, "error", err)
		return
	}
	if err := cmd.Start(); err != nil {
		t.finishRun(rid, "error", err)
		return
	}

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		t.parseStream(ctx, rid, def, stdout)
	}()
	go func() {
		defer wg.Done()
		t.parseStream(ctx, rid, def, stderr)
	}()
	waitErr := cmd.Wait()
	wg.Wait()

	status := "completed"
	if ctx.Err() != nil {
		status = "cancelled"
	} else if waitErr != nil {
		// "exit status N" é comum quando algum teste falha — não conta como erro.
		var exitErr *exec.ExitError
		if !errors.As(waitErr, &exitErr) {
			t.finishRun(rid, "error", waitErr)
			return
		}
	}
	t.finishRun(rid, status, nil)
}

func buildCommand(ctx context.Context, def TestRunner) (*exec.Cmd, error) {
	switch def.Kind {
	case TestRunnerGo:
		return exec.CommandContext(ctx, "go", "test", "-json", "./..."), nil
	case TestRunnerCargo:
		return exec.CommandContext(ctx, "cargo", "test", "--no-fail-fast", "--", "--format", "pretty"), nil
	case TestRunnerVitest:
		runner := detectNodeRunner(def.Cwd)
		args := []string{"x", "vitest", "run", "--reporter=tap"}
		if runner == "pnpm" || runner == "yarn" {
			args = []string{"exec", "vitest", "run", "--reporter=tap"}
		}
		if runner == "npm" {
			runner = "npx"
			args = []string{"vitest", "run", "--reporter=tap"}
		}
		return exec.CommandContext(ctx, runner, args...), nil
	}
	return nil, fmt.Errorf("kind desconhecido: %s", def.Kind)
}

func (t *Tests) parseStream(ctx context.Context, rid int64, def TestRunner, r io.Reader) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	parser := newParserFor(def.Kind)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return
		default:
		}
		line := scanner.Text()
		if rid != atomic.LoadInt64(&t.runID) {
			return
		}
		emit(evtTestsLog, map[string]any{"runnerId": def.ID, "chunk": line + "\n"})
		updates := parser.feed(line)
		for _, n := range updates {
			t.applyNode(rid, def.ID, n)
		}
	}
	if flusher, ok := parser.(interface{ flushPending() []TestNode }); ok {
		for _, n := range flusher.flushPending() {
			t.applyNode(rid, def.ID, n)
		}
	}
}

func (t *Tests) applyNode(rid int64, runnerID string, node TestNode) {
	if rid != atomic.LoadInt64(&t.runID) {
		return
	}
	t.runMu.Lock()
	if t.nodes == nil {
		t.runMu.Unlock()
		return
	}
	prev, exists := t.nodes[node.ID]
	if !exists {
		t.nodeKeys = append(t.nodeKeys, node.ID)
	}
	// Não regredir status terminal (ex.: pass → running por output tardio).
	if exists && isTerminal(prev.Status) && !isTerminal(node.Status) {
		t.runMu.Unlock()
		return
	}
	t.nodes[node.ID] = node
	if t.current != nil {
		// Recalcula o sumário só quando vira terminal e não era.
		if isTerminal(node.Status) && (!exists || !isTerminal(prev.Status)) {
			t.current.Total++
			switch node.Status {
			case TestStatusPassed:
				t.current.Passed++
			case TestStatusFailed:
				t.current.Failed++
			case TestStatusSkipped:
				t.current.Skipped++
			}
		}
	}
	t.runMu.Unlock()
	emit(evtTestsUpdate, map[string]any{"runnerId": runnerID, "node": node})
}

func isTerminal(s TestNodeStatus) bool {
	return s == TestStatusPassed || s == TestStatusFailed || s == TestStatusSkipped
}

func (t *Tests) finishRun(rid int64, status string, err error) {
	t.runMu.Lock()
	if rid != atomic.LoadInt64(&t.runID) {
		t.runMu.Unlock()
		return
	}
	if t.current == nil {
		t.runMu.Unlock()
		return
	}
	t.current.Status = status
	t.current.FinishedAt = time.Now().UnixMilli()
	if err != nil {
		t.current.Error = err.Error()
	}
	summary := *t.current
	t.cancel = nil
	t.runMu.Unlock()
	emit(evtTestsDone, map[string]any{"summary": summary})
}

// ── Parsers por runner ───────────────────────────────────────────────────────

type lineParser interface {
	feed(line string) []TestNode
}

func newParserFor(kind TestRunnerKind) lineParser {
	switch kind {
	case TestRunnerGo:
		return &goJSONParser{started: map[string]int64{}, output: map[string]*strings.Builder{}}
	case TestRunnerVitest:
		return &tapParser{}
	case TestRunnerCargo:
		return &cargoParser{}
	}
	return &noopParser{}
}

type noopParser struct{}

func (noopParser) feed(string) []TestNode { return nil }

// — go test -json: cada linha é um JSON com Action/Package/Test/Output/Elapsed.

type goJSONParser struct {
	started map[string]int64 // key=pkg|test → unix ms quando virou running
	output  map[string]*strings.Builder
}

func (p *goJSONParser) bufFor(key string) *strings.Builder {
	if p.output == nil {
		p.output = map[string]*strings.Builder{}
	}
	b, ok := p.output[key]
	if !ok {
		b = &strings.Builder{}
		p.output[key] = b
	}
	return b
}

type goEvent struct {
	Time    string  `json:"Time"`
	Action  string  `json:"Action"`
	Package string  `json:"Package"`
	Test    string  `json:"Test"`
	Output  string  `json:"Output"`
	Elapsed float64 `json:"Elapsed"`
}

func (p *goJSONParser) feed(line string) []TestNode {
	if line == "" || line[0] != '{' {
		return nil
	}
	var ev goEvent
	if err := json.Unmarshal([]byte(line), &ev); err != nil {
		return nil
	}
	if ev.Package == "" {
		return nil
	}
	pkgID := "pkg::" + ev.Package
	out := []TestNode{}

	if ev.Test == "" {
		// Eventos no nível do pacote — usamos como suite root.
		switch ev.Action {
		case "output":
			p.bufFor(ev.Package).WriteString(ev.Output)
		case "run", "start":
			out = append(out, TestNode{
				ID: pkgID, Name: ev.Package, File: ev.Package, IsSuite: true, Status: TestStatusRunning,
			})
		case "pass":
			out = append(out, TestNode{
				ID: pkgID, Name: ev.Package, File: ev.Package, IsSuite: true,
				Status: TestStatusPassed, DurationMs: int64(ev.Elapsed * 1000),
			})
			delete(p.output, ev.Package)
		case "fail":
			failure := ""
			if b, ok := p.output[ev.Package]; ok {
				failure = strings.TrimSpace(stripGoOutputPrefix(b.String()))
			}
			out = append(out, TestNode{
				ID: pkgID, Name: ev.Package, File: ev.Package, IsSuite: true,
				Status: TestStatusFailed, DurationMs: int64(ev.Elapsed * 1000),
				Failure: failure,
			})
			delete(p.output, ev.Package)
		case "skip":
			out = append(out, TestNode{
				ID: pkgID, Name: ev.Package, File: ev.Package, IsSuite: true, Status: TestStatusSkipped,
			})
			delete(p.output, ev.Package)
		}
		return out
	}

	// Testes individuais — go gera "TestFoo/Subtest" para subtests.
	id := pkgID + "::" + ev.Test
	parent := pkgID
	name := ev.Test
	if idx := strings.LastIndex(ev.Test, "/"); idx >= 0 {
		parent = pkgID + "::" + ev.Test[:idx]
		name = ev.Test[idx+1:]
	}
	bufKey := ev.Package + "|" + ev.Test
	switch ev.Action {
	case "output":
		p.bufFor(bufKey).WriteString(ev.Output)
	case "run":
		out = append(out, TestNode{
			ID: id, ParentID: parent, Name: name, File: ev.Package, Status: TestStatusRunning,
		})
	case "pass":
		out = append(out, TestNode{
			ID: id, ParentID: parent, Name: name, File: ev.Package,
			Status: TestStatusPassed, DurationMs: int64(ev.Elapsed * 1000),
		})
		delete(p.output, bufKey)
	case "fail":
		failure := strings.TrimSpace(ev.Output)
		if b, ok := p.output[bufKey]; ok {
			failure = strings.TrimSpace(stripGoOutputPrefix(b.String()))
		}
		out = append(out, TestNode{
			ID: id, ParentID: parent, Name: name, File: ev.Package,
			Status: TestStatusFailed, DurationMs: int64(ev.Elapsed * 1000),
			Failure: failure,
		})
		delete(p.output, bufKey)
	case "skip":
		out = append(out, TestNode{
			ID: id, ParentID: parent, Name: name, File: ev.Package, Status: TestStatusSkipped,
		})
		delete(p.output, bufKey)
	}
	return out
}

// stripGoOutputPrefix limpa o ruído de envoltório que `go test -json`
// adiciona em cada linha de Output: "=== RUN", "=== PAUSE", "=== CONT",
// "--- FAIL: ... (Xs)" e os "    " que prefixam linhas de log do testing.T.
func stripGoOutputPrefix(s string) string {
	lines := strings.Split(s, "\n")
	out := make([]string, 0, len(lines))
	for _, l := range lines {
		t := strings.TrimRight(l, "\r")
		trim := strings.TrimSpace(t)
		if strings.HasPrefix(trim, "=== RUN") ||
			strings.HasPrefix(trim, "=== PAUSE") ||
			strings.HasPrefix(trim, "=== CONT") ||
			strings.HasPrefix(trim, "=== NAME") ||
			strings.HasPrefix(trim, "--- FAIL") ||
			strings.HasPrefix(trim, "--- PASS") ||
			strings.HasPrefix(trim, "--- SKIP") ||
			strings.HasPrefix(trim, "PASS") ||
			strings.HasPrefix(trim, "FAIL") ||
			strings.HasPrefix(trim, "ok  \t") ||
			strings.HasPrefix(trim, "FAIL\t") {
			continue
		}
		// testing.T.Logf indenta com 4 espaços ou tab — preserva conteúdo,
		// mas sem o prefixo, deixando legível.
		out = append(out, strings.TrimPrefix(strings.TrimPrefix(t, "    "), "\t"))
	}
	return strings.Join(out, "\n")
}

// — TAP (vitest --reporter=tap):
//   ok 1 - foo > bar
//   not ok 2 - baz > qux
//   ok 3 - skip-me # SKIP reason
//   # tests 10
// Vitest prefixa os testes com o caminho de suites separadas por " > ".

var tapLine = regexp.MustCompile(`^(ok|not ok)\s+(\d+)\s*-?\s*(.*)$`)

type tapParser struct {
	suiteSeen  map[string]bool
	pending    *TestNode // último leaf falho aguardando bloco de diagnóstico YAML
	buf        []string
	collecting bool
}

func (p *tapParser) flushPending() []TestNode {
	if p.pending == nil {
		return nil
	}
	node := *p.pending
	if len(p.buf) > 0 {
		extra := strings.TrimSpace(strings.Join(p.buf, "\n"))
		if extra != "" {
			if node.Failure != "" {
				node.Failure = node.Failure + "\n" + extra
			} else {
				node.Failure = extra
			}
		}
	}
	p.pending = nil
	p.buf = nil
	p.collecting = false
	if node.Failure == "" {
		return nil
	}
	return []TestNode{node}
}

func (p *tapParser) feed(line string) []TestNode {
	if p.suiteSeen == nil {
		p.suiteSeen = map[string]bool{}
	}
	line = strings.TrimRight(line, "\r")
	trimmed := strings.TrimSpace(line)

	// Bloco YAML de diagnóstico (vitest emite após "not ok" entre `---` e `...`).
	if p.pending != nil {
		if trimmed == "---" || trimmed == "{" {
			p.collecting = true
			p.buf = p.buf[:0]
			return nil
		}
		if p.collecting {
			if trimmed == "..." || trimmed == "}" {
				return p.flushPending()
			}
			p.buf = append(p.buf, strings.TrimPrefix(line, "  "))
			return nil
		}
		if strings.HasPrefix(line, "ok ") || strings.HasPrefix(line, "not ok ") || strings.HasPrefix(line, "#") {
			out := p.flushPending()
			if m := tapLine.FindStringSubmatch(line); m != nil {
				return append(out, p.parseAssertion(line, m)...)
			}
			return out
		}
	}

	m := tapLine.FindStringSubmatch(line)
	if m == nil {
		return nil
	}
	return p.parseAssertion(line, m)
}

func (p *tapParser) parseAssertion(_ string, m []string) []TestNode {
	rest := strings.TrimSpace(m[3])
	skipped := false
	failure := ""
	if i := strings.Index(rest, " # "); i >= 0 {
		directive := strings.TrimSpace(rest[i+3:])
		rest = strings.TrimSpace(rest[:i])
		up := strings.ToUpper(directive)
		switch {
		case strings.HasPrefix(up, "SKIP"):
			skipped = true
		case strings.HasPrefix(up, "TODO"):
			skipped = true
		case strings.HasPrefix(directive, "time=") || strings.HasPrefix(directive, "{"):
			// Vitest costuma adicionar "# time=Xms" ou abrir bloco YAML
			// com "{" — não é mensagem de erro, ignoramos.
		default:
			failure = directive
		}
	}
	parts := strings.Split(rest, " > ")
	out := []TestNode{}
	parentID := ""
	for i := 0; i < len(parts)-1; i++ {
		id := "suite::" + strings.Join(parts[:i+1], " > ")
		if !p.suiteSeen[id] {
			p.suiteSeen[id] = true
			out = append(out, TestNode{
				ID: id, ParentID: parentID, Name: parts[i],
				File: parts[0], IsSuite: true, Status: TestStatusRunning,
			})
		}
		parentID = id
	}
	leaf := parts[len(parts)-1]
	leafID := "test::" + rest
	status := TestStatusPassed
	if m[1] == "not ok" {
		status = TestStatusFailed
	}
	if skipped {
		status = TestStatusSkipped
	}
	leafNode := TestNode{
		ID: leafID, ParentID: parentID, Name: leaf,
		File: parts[0], Status: status, Failure: failure,
	}
	out = append(out, leafNode)
	if status == TestStatusFailed {
		// Guarda referência para mesclar com o bloco YAML que vem a seguir.
		// Algumas versões do vitest abrem o bloco já no diretivo (`# time=Xms {`).
		clone := leafNode
		p.pending = &clone
		p.buf = nil
		p.collecting = inlineBraceOpen(m[3])
	}
	return out
}

func inlineBraceOpen(suffix string) bool {
	return strings.HasSuffix(strings.TrimSpace(suffix), "{")
}

// — cargo test (formato pretty):
//   running 5 tests
//   test tests::a ... ok
//   test tests::b ... FAILED
//   test tests::c ... ignored

var cargoLine = regexp.MustCompile(`^test\s+(\S+)\s+\.\.\.\s+(ok|FAILED|ignored)(?:\s+<\s*([\d.]+)s>)?\s*$`)

type cargoParser struct{}

func (cargoParser) feed(line string) []TestNode {
	line = strings.TrimSpace(line)
	m := cargoLine.FindStringSubmatch(line)
	if m == nil {
		return nil
	}
	name := m[1]
	id := "test::" + name
	parentID := ""
	display := name
	if idx := strings.LastIndex(name, "::"); idx >= 0 {
		parentID = "suite::" + name[:idx]
		display = name[idx+2:]
	}
	status := TestStatusPassed
	switch m[2] {
	case "FAILED":
		status = TestStatusFailed
	case "ignored":
		status = TestStatusSkipped
	}
	var dur int64
	if m[3] != "" {
		if f, err := strconv.ParseFloat(m[3], 64); err == nil {
			dur = int64(f * 1000)
		}
	}
	out := []TestNode{}
	if parentID != "" {
		out = append(out, TestNode{
			ID: parentID, Name: strings.TrimPrefix(parentID, "suite::"),
			IsSuite: true, Status: TestStatusRunning,
		})
	}
	out = append(out, TestNode{
		ID: id, ParentID: parentID, Name: display,
		Status: status, DurationMs: dur,
	})
	return out
}

// detectNodeRunner é reusado de tasks.go.
