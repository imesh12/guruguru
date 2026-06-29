import { useState, type FormEvent } from 'react';

import { useAdminAuth } from '../auth/AdminAuthContext';

const inputClassName =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200';

export function AdminAuthControl() {
  const { role, username, login, logout } = useAdminAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closeDialog = () => {
    if (submitting) {
      return;
    }

    setDialogOpen(false);
    setUsernameInput('');
    setPasswordInput('');
    setError(null);
  };

  const openDialog = () => {
    setDialogOpen(true);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await login(usernameInput, passwordInput);
      closeDialog();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '管理者ログインに失敗しました。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {role === 'admin' ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-2 py-2">
          <span className="hidden text-sm font-medium text-emerald-800 sm:inline">
            {username ? `管理者: ${username}` : '管理者モード'}
          </span>
          <button
            type="button"
            onClick={logout}
            className="rounded-lg border border-emerald-600 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 active:translate-y-px"
          >
            管理者ログアウト
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={openDialog}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 active:translate-y-px"
        >
          管理者ログイン
        </button>
      )}

      {dialogOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Admin</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-900">管理者ログイン</h2>
                <p className="mt-1 text-sm text-slate-600">設定とシステム状態を表示するには管理者ログインが必要です。</p>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-semibold text-slate-500 transition hover:bg-slate-50 active:translate-y-px"
                aria-label="Close admin login"
              >
                閉じる
              </button>
            </div>

            <form className="mt-5 space-y-3" onSubmit={handleSubmit}>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="admin-username">
                  Username
                </label>
                <input
                  id="admin-username"
                  value={usernameInput}
                  onChange={(event) => setUsernameInput(event.target.value)}
                  className={inputClassName}
                  autoComplete="username"
                  disabled={submitting}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="admin-password">
                  Password
                </label>
                <input
                  id="admin-password"
                  type="password"
                  value={passwordInput}
                  onChange={(event) => setPasswordInput(event.target.value)}
                  className={inputClassName}
                  autoComplete="current-password"
                  disabled={submitting}
                />
              </div>

              {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeDialog}
                  disabled={submitting}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={submitting || !usernameInput.trim() || !passwordInput}
                  className="rounded-xl border border-sky-700 bg-sky-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-800 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'ログイン中...' : 'ログイン'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
