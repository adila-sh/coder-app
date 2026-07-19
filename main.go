package main

import (
	"embed"
	_ "embed"
	"log"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var embeddedAppIcon []byte

func main() {
	cfg := NewConfig()
	app := NewApp(cfg)
	if initial := resolveInitialPath(os.Args); initial != "" {
		app.SetInitialPath(initial)
	}
	term := NewTerminal()
	git := NewGit(cfg)
	about := NewAbout()
	lsp := NewLSP()
	cmd := NewCommandCenter(git, cfg)
	gh := NewGitHub(cfg, git)
	sp := NewSpotify(cfg)
	linear := NewLinear(cfg)
	tasks := NewTasks(term)
	tests := NewTests()
	wcfg := NewWorkspaceConfig()
	cfg.AttachWorkspace(wcfg)
	claude := NewClaude(cfg)
	codex := NewCodex(cfg)
	indexer := NewIndexer(cfg)

	a := application.New(application.Options{
		Name:        "Adila IDE",
		Description: "O editor de código forjado para fullstack",
		Icon:        embeddedAppIcon,
		Linux: application.LinuxOptions{
			ProgramName: "adila",
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		// A ordem dos Services é a ordem em que ServiceStartup é chamado,
		// e a inversa em ServiceShutdown. Mantemos cfg primeiro para que
		// outros services já encontrem ~/.config/adila/settings.json carregado.
		Services: []application.Service{
			application.NewService(cfg),
			application.NewService(wcfg),
			application.NewService(app),
			application.NewService(term),
			application.NewService(git),
			application.NewService(about),
			application.NewService(lsp),
			application.NewService(cmd),
			application.NewService(gh),
			application.NewService(sp),
			application.NewService(linear),
			application.NewService(claude),
			application.NewService(codex),
			application.NewService(indexer),
			application.NewService(tasks),
			application.NewService(tests),
			application.NewService(bench),
		},
	})

	a.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "Adila IDE",
		Width:            1280,
		Height:           800,
		Frameless:        true,
		URL:              "/",
		BackgroundType:   application.BackgroundTypeTranslucent,
		BackgroundColour: application.RGBA{Red: 24, Green: 24, Blue: 27, Alpha: 0},
		Linux: application.LinuxWindow{
			Icon:                embeddedAppIcon,
			WindowIsTranslucent: true,
		},
	})

	if err := a.Run(); err != nil {
		log.Fatal(err)
	}
}

// resolveInitialPath pega o primeiro arg posicional não-flag, resolve para
// caminho absoluto e valida que é um diretório existente. Retorna "" se
// nada foi passado ou o caminho é inválido.
func resolveInitialPath(args []string) string {
	for _, a := range args[1:] {
		if a == "" || a[0] == '-' {
			continue
		}
		abs, err := filepath.Abs(a)
		if err != nil {
			return ""
		}
		info, err := os.Stat(abs)
		if err != nil || !info.IsDir() {
			return ""
		}
		return abs
	}
	return ""
}
