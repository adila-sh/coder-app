package main

import (
	"context"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// service_lifecycle.go conecta os métodos de ciclo (`startup`/`shutdown`)
// herdados do código v2 às interfaces da v3 (ServiceStartup/ServiceShutdown).
// Mantemos os métodos privados como estão para o diff por domínio ficar
// pequeno e auditável; estes wrappers públicos são o ponto único de
// integração com o pacote application.

func (a *App) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	a.startup(ctx)
	return nil
}

func (a *About) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	a.startup(ctx)
	return nil
}

func (c *CommandCenter) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	c.startup(ctx)
	return nil
}

func (c *Config) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	c.startup(ctx)
	return nil
}

func (c *Config) ServiceShutdown() error {
	c.shutdown(nil)
	return nil
}

func (c *Claude) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	c.startup(ctx)
	return nil
}

func (c *Codex) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	c.startup(ctx)
	return nil
}

func (i *Indexer) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	i.startup(ctx)
	return nil
}

func (i *Indexer) ServiceShutdown() error {
	i.shutdown(nil)
	return nil
}

func (g *Git) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	g.startup(ctx)
	return nil
}

func (g *GitHub) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	g.startup(ctx)
	return nil
}

func (l *Linear) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	l.startup(ctx)
	return nil
}

func (l *LSP) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	l.startup(ctx)
	return nil
}

func (l *LSP) ServiceShutdown() error {
	l.shutdown(nil)
	return nil
}

func (s *Spotify) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	s.startup(ctx)
	return nil
}

func (t *Tasks) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	t.startup(ctx)
	return nil
}

func (t *Tests) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	t.startup(ctx)
	return nil
}

func (t *Tests) ServiceShutdown() error {
	if t.cancel != nil {
		t.cancel()
	}
	return nil
}

func (t *Terminal) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	t.startup(ctx)
	return nil
}

func (t *Terminal) ServiceShutdown() error {
	t.shutdown(nil)
	return nil
}

func (w *WorkspaceConfig) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	w.startup(ctx)
	return nil
}

func (w *WorkspaceConfig) ServiceShutdown() error {
	w.shutdown(nil)
	return nil
}
