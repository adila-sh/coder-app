import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { ClaudeProfileCard } from "@/features/claude/ClaudeProfileCard";
import { CodexProfileCard } from "@/features/codex/CodexProfileCard";
import { GitHubProfileCard } from "@/features/git/GitHubProfileCard";
import { LinearProfileCard } from "@/features/linear/LinearProfileCard";
import { SpotifyProfileCard } from "@/features/spotify/SpotifyProfileCard";
import {
  Activity,
  ChevronRight,
  Clock,
  FolderOpen,
  Keyboard,
  ListChecks,
  Settings,
  TestTube,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import React from "react";

type ActionRowProps = {
  icon: React.ReactNode;
  label: string;
  shortcut?: React.ReactNode;
  onClick: () => void;
};

function ActionRow({ icon, label, shortcut, onClick }: ActionRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm hover:bg-accent hover:text-accent-foreground text-left group transition-colors"
    >
      <span className="text-muted-foreground group-hover:text-foreground transition-colors shrink-0">
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      {shortcut && (
        <span className="opacity-50 group-hover:opacity-100 transition-opacity">{shortcut}</span>
      )}
    </button>
  );
}

type Props = {
  onOpenFolder: () => void;
  onOpenSettings: () => void;
  onOpenKeybindings: () => void;
  onOpenGit: () => void;
  onOpenOnboarding: () => void;
  onOpenSpotify: () => void;
  onOpenActions: () => void;
  onOpenTests: () => void;
  onOpenTasks: () => void;
  recentFolders?: string[];
  onOpenRecentFolder?: (path: string) => void;
  onRemoveRecentFolder?: (path: string) => void;
};

export function WelcomePage({
  onOpenFolder,
  onOpenSettings,
  onOpenKeybindings,
  onOpenOnboarding,
  onOpenSpotify,
  onOpenActions,
  onOpenTests,
  onOpenTasks,
  recentFolders = [],
  onOpenRecentFolder,
  onRemoveRecentFolder,
}: Props) {
  return (
    <div className="absolute inset-0 overflow-y-auto scrollbar">
      <div className="flex min-h-full flex-col justify-center py-12">
        {/* Hero */}
        <motion.div
          className="flex flex-col items-center gap-3 pb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        >
          <motion.img
            src="/icon.png"
            alt="Adila IDE"
            className="w-14 h-14 object-contain"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.05, type: "spring", stiffness: 260, damping: 20 }}
          />
          <motion.div
            className="text-center"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.12 }}
          >
            <h1 className="text-2xl font-semibold tracking-tight">Adila IDE</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              O editor de código forjado para fullstack.
            </p>
          </motion.div>
        </motion.div>

        {/* Content */}
        <div className="max-w-3xl mx-auto px-10 py-10">
          <motion.div
            className="mb-8"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.16 }}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <GitHubProfileCard />
              <SpotifyProfileCard onOpen={onOpenSpotify} />
            </div>
            <div className="mt-3">
              <LinearProfileCard />
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <ClaudeProfileCard onOpen={onOpenSettings} />
              <CodexProfileCard onOpen={onOpenSettings} />
            </div>
          </motion.div>
          <div className="grid grid-cols-2 gap-10">
            {/* Iniciar */}
            <motion.section
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, delay: 0.18, ease: "easeOut" }}
            >
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3 px-3">
                Iniciar
              </h2>
              <div>
                <ActionRow
                  icon={<FolderOpen className="size-4" />}
                  label="Abrir pasta..."
                  shortcut={
                    <KbdGroup>
                      <Kbd>Ctrl</Kbd>
                      <Kbd>K</Kbd>
                      <Kbd>Ctrl</Kbd>
                      <Kbd>O</Kbd>
                    </KbdGroup>
                  }
                  onClick={onOpenFolder}
                />

                <ActionRow
                  icon={<Settings className="size-4" />}
                  label="Configurações"
                  shortcut={
                    <KbdGroup>
                      <Kbd>Ctrl</Kbd>
                      <Kbd>,</Kbd>
                    </KbdGroup>
                  }
                  onClick={onOpenSettings}
                />
                <ActionRow
                  icon={<Keyboard className="size-4" />}
                  label="Atalhos de teclado"
                  onClick={onOpenKeybindings}
                />
                <ActionRow
                  icon={<Activity className="size-4" />}
                  label="GitHub Actions"
                  onClick={onOpenActions}
                />
                <ActionRow
                  icon={<TestTube className="size-4" />}
                  label="Testes"
                  onClick={onOpenTests}
                />
                <ActionRow
                  icon={<ListChecks className="size-4" />}
                  label="Tasks"
                  onClick={onOpenTasks}
                />
              </div>
            </motion.section>

            {/* Recentes */}
            <motion.section
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, delay: 0.22, ease: "easeOut" }}
            >
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3 px-3">
                Recentes
              </h2>
              <div className="flex flex-col gap-0.5">
                {recentFolders.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2 px-3">
                    <Clock className="size-4 shrink-0" />
                    <span>Nenhum projeto recente.</span>
                  </div>
                ) : (
                  recentFolders.map((path) => {
                    const name = path.split("/").filter(Boolean).pop() ?? path;
                    const parent = path.split("/").slice(0, -1).join("/") || "/";
                    return (
                      <div
                        key={path}
                        className="group flex items-center gap-1 rounded-md hover:bg-accent"
                      >
                        <button
                          type="button"
                          onClick={() => onOpenRecentFolder?.(path)}
                          className="flex-1 flex items-center gap-3 px-3 py-2 text-sm text-left"
                        >
                          <FolderOpen className="size-4 text-muted-foreground group-hover:text-foreground shrink-0 transition-colors" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{name}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {parent}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveRecentFolder?.(path)}
                          aria-label="Remover dos recentes"
                          className="opacity-0 group-hover:opacity-100 p-1.5 mr-1 rounded text-muted-foreground hover:text-foreground transition-opacity"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.section>
          </div>
          <div className="w-full flex justify-between items-center border border-border h-36 relative rounded-lg overflow-hidden mt-12">
            <div className="p-8 flex flex-col gap-1">
              <h2 className="text-xl font-semibold text-foreground">Tour de boas-vindas</h2>
              <p className="text-sm text-muted-foreground">Vamos começar a usar o Adila IDE</p>
            </div>
            <img
              src="/welcome.jpg"
              alt="Adila IDE"
              className="w-[40%] rounded-lg h-full object-cover"
            />
            <Button
              onClick={onOpenOnboarding}
              variant="default"
              size="icon"
              className="absolute bottom-4 right-4 rounded-full"
              aria-label="Iniciar tour"
              title="Iniciar tour de boas-vindas"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
