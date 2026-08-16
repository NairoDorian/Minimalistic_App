import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Code,
  Terminal,
  FolderOpen,
  RotateCcw,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Info,
  AlertTriangle,
  Play,
} from 'lucide-react';
import { toast } from '../lib/toast';
import { isTauri } from '../lib/tauri';

interface DeveloperTabProps {
  onStatusChange?: (status: string) => void;
  onSettingsReset?: () => void;
}

export function DeveloperTab({ onStatusChange, onSettingsReset }: DeveloperTabProps) {
  const [selectedCommand, setSelectedCommand] = useState<string>('get_app_info');
  const [commandOutput, setCommandOutput] = useState<string>(
    '// Run a command to view IPC payload'
  );
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [resetConfirm, setResetConfirm] = useState<boolean>(false);

  const availableCommands = [
    { id: 'get_app_info', label: 'get_app_info', desc: 'Fetch product metadata & versions' },
    { id: 'get_app_settings', label: 'get_app_settings', desc: 'Fetch persisted AppSettings JSON' },
    {
      id: 'get_system_stats',
      label: 'get_system_stats',
      desc: 'Fetch process and system telemetry',
    },
  ];

  const handleRunCommand = useCallback(async () => {
    if (!isTauri) {
      setCommandOutput(
        JSON.stringify(
          {
            mockResult: true,
            command: selectedCommand,
            environment: 'Web Browser Preview',
            timestamp: new Date().toISOString(),
          },
          null,
          2
        )
      );
      toast.info(`[Web Preview] Executed mock ${selectedCommand}`);
      return;
    }

    setIsRunning(true);
    try {
      const result = await invoke(selectedCommand);
      setCommandOutput(JSON.stringify(result, null, 2));
      toast.success(`IPC '${selectedCommand}' executed successfully`);
      onStatusChange?.(`IPC '${selectedCommand}' executed`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setCommandOutput(`// Error invoking ${selectedCommand}:\n${errMsg}`);
      toast.error(`IPC error: ${errMsg}`);
      onStatusChange?.(`IPC error on ${selectedCommand}`);
    } finally {
      setIsRunning(false);
    }
  }, [selectedCommand, onStatusChange]);

  const handleOpenConfigDir = useCallback(async () => {
    if (!isTauri) {
      toast.info('[Web Preview] App config dir simulated: %APPDATA%\\com.minimalistic.app');
      return;
    }

    try {
      await invoke('open_app_data_dir');
      toast.success('Opened App Configuration Directory in Explorer/Finder');
      onStatusChange?.('Opened app config folder');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to open directory: ${msg}`);
    }
  }, [onStatusChange]);

  const handleResetSettings = useCallback(async () => {
    if (!resetConfirm) {
      setResetConfirm(true);
      setTimeout(() => setResetConfirm(false), 4000);
      return;
    }

    if (isTauri) {
      try {
        await invoke('reset_app_settings');
        toast.success('App settings restored to factory defaults');
        onSettingsReset?.();
        onStatusChange?.('Settings restored to defaults');
      } catch (err: unknown) {
        toast.error(`Failed to reset settings: ${String(err)}`);
      }
    } else {
      toast.success('[Web Preview] Settings reset to default');
      onSettingsReset?.();
    }
    setResetConfirm(false);
  }, [resetConfirm, onSettingsReset, onStatusChange]);

  // Viewport and environment telemetry
  const [viewport, setViewport] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
    pixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
  });

  useEffect(() => {
    const handleResize = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
        pixelRatio: window.devicePixelRatio,
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div
      className="settings-card"
      id="panel-developer"
      role="tabpanel"
      tabIndex={0}
      aria-labelledby="tab-developer"
    >
      <div className="settings-card-header">
        <h2 className="settings-card-title">Developer Hub & IPC Playground</h2>
        <p className="settings-card-desc">
          Live developer tools, real-time IPC command testing, and runtime diagnostics.
        </p>
      </div>

      {/* IPC Playground */}
      <div className="dev-section">
        <div className="dev-section-header">
          <Terminal size={16} color="var(--accent-cyan)" />
          <span className="dev-section-title">Rust IPC Command Inspector</span>
        </div>

        <div className="ipc-runner-bar">
          <select
            className="ipc-select"
            value={selectedCommand}
            onChange={(e) => setSelectedCommand(e.target.value)}
            aria-label="Select IPC command to execute"
          >
            {availableCommands.map((cmd) => (
              <option key={cmd.id} value={cmd.id}>
                {cmd.label} — {cmd.desc}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-update-primary"
            onClick={handleRunCommand}
            disabled={isRunning}
          >
            <Play size={13} />
            <span>{isRunning ? 'Invoking...' : 'Execute'}</span>
          </button>
        </div>

        <pre className="ipc-output-box" tabIndex={0} aria-label="IPC Command Output">
          <code>{commandOutput}</code>
        </pre>
      </div>

      {/* Interactive Toast Test Bench */}
      <div className="dev-section">
        <div className="dev-section-header">
          <Sparkles size={16} color="var(--accent-cyan)" />
          <span className="dev-section-title">Notification & Toast Benchmark</span>
        </div>
        <p className="dev-section-desc">
          Test reactive toast notifications with auto-dismiss timers and accessibility live regions.
        </p>

        <div className="toast-bench-grid">
          <button
            type="button"
            className="btn-toast-test toast-test-success"
            onClick={() => toast.success('Operation completed successfully!')}
          >
            <CheckCircle2 size={13} />
            <span>Trigger Success</span>
          </button>
          <button
            type="button"
            className="btn-toast-test toast-test-info"
            onClick={() => toast.info('System background sync finished.')}
          >
            <Info size={13} />
            <span>Trigger Info</span>
          </button>
          <button
            type="button"
            className="btn-toast-test toast-test-warning"
            onClick={() => toast.warning('Network latency elevated.')}
          >
            <AlertTriangle size={13} />
            <span>Trigger Warning</span>
          </button>
          <button
            type="button"
            className="btn-toast-test toast-test-error"
            onClick={() => toast.error('Failed to commit database transaction.')}
          >
            <AlertCircle size={13} />
            <span>Trigger Error</span>
          </button>
        </div>
      </div>

      {/* Quick Diagnostics & Native Actions */}
      <div className="dev-section">
        <div className="dev-section-header">
          <Code size={16} color="var(--accent-cyan)" />
          <span className="dev-section-title">Quick Actions & Environment</span>
        </div>

        <div className="dev-quick-actions">
          <button type="button" className="btn-update-secondary" onClick={handleOpenConfigDir}>
            <FolderOpen size={14} />
            <span>Open App Data Folder</span>
          </button>
          <button
            type="button"
            className={`btn-update-secondary ${resetConfirm ? 'btn-danger-confirm' : ''}`}
            onClick={handleResetSettings}
          >
            <RotateCcw size={14} />
            <span>{resetConfirm ? 'Click to Confirm Reset' : 'Reset All Settings'}</span>
          </button>
        </div>

        <div className="dev-telemetry-row">
          <span>
            Viewport: {viewport.width}x{viewport.height} (DPR: {viewport.pixelRatio})
          </span>
          <span>Runtime: {isTauri ? 'Native Tauri v2' : 'Vite Dev Web'}</span>
        </div>
      </div>
    </div>
  );
}
