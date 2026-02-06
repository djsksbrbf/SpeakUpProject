import { FormEvent, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";

type Reply = {
  id: number;
  thread_id: number;
  parent_id: number | null;
  body: string;
  author_name: string | null;
  is_anonymous: boolean;
  created_at: string;
};

type Thread = {
  id: number;
  title: string;
  body: string;
  author_name: string | null;
  is_anonymous: boolean;
  created_at: string;
  replies: Reply[];
};

type ThreadCreateResponse = Thread & { owner_token: string };
type ReplyCreateResponse = Reply & { owner_token: string };

const apiBaseUrl = import.meta.env.VITE_API_URL || "/api";
const threadTokenStorageKey = "forum-thread-owner-tokens";
const replyTokenStorageKey = "forum-reply-owner-tokens";
const authTokenStorageKey = "forum-auth-token";
const authUserStorageKey = "forum-auth-user";

type AuthUser = {
  id: number;
  username: string;
  email: string;
};

function readTokenMap(storageKey: string): Record<number, string> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return Object.fromEntries(Object.entries(parsed).map(([id, token]) => [Number(id), token]));
  } catch {
    return {};
  }
}

function readStoredAuthUser(): AuthUser | null {
  try {
    const raw = window.localStorage.getItem(authUserStorageKey);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function generateOwnerToken(): string {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID().replace(/-/g, "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function formatAuthor(name: string | null, isAnonymous: boolean): string {
  if (isAnonymous) return "Anonymous";
  return name || "Unknown";
}

function formatDate(dateString: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(dateString));
}

export default function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const savedTheme = window.localStorage.getItem("forum-theme");
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [threadTitle, setThreadTitle] = useState("");
  const [threadBody, setThreadBody] = useState("");
  const [threadName, setThreadName] = useState("");
  const [threadAnonymous, setThreadAnonymous] = useState(true);

  const [replyBodyByThread, setReplyBodyByThread] = useState<Record<number, string>>({});
  const [replyNameByThread, setReplyNameByThread] = useState<Record<number, string>>({});
  const [replyAnonymousByThread, setReplyAnonymousByThread] = useState<Record<number, boolean>>({});
  const [replyTargetByThread, setReplyTargetByThread] = useState<Record<number, number | null>>({});
  const [threadTokens, setThreadTokens] = useState<Record<number, string>>(() => readTokenMap(threadTokenStorageKey));
  const [replyTokens, setReplyTokens] = useState<Record<number, string>>(() => readTokenMap(replyTokenStorageKey));
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(() => window.localStorage.getItem(authTokenStorageKey));
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => readStoredAuthUser());
  const isAuthed = Boolean(authToken && authUser);

  async function loadThreads() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/threads`);
      if (!response.ok) throw new Error("Could not load threads.");
      const data = (await response.json()) as Thread[];
      setThreads(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unknown error.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isAuthed) {
      void loadThreads();
    } else {
      setThreads([]);
    }
  }, [isAuthed]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem("forum-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(threadTokenStorageKey, JSON.stringify(threadTokens));
  }, [threadTokens]);

  useEffect(() => {
    window.localStorage.setItem(replyTokenStorageKey, JSON.stringify(replyTokens));
  }, [replyTokens]);

  useEffect(() => {
    if (authToken) {
      window.localStorage.setItem(authTokenStorageKey, authToken);
    } else {
      window.localStorage.removeItem(authTokenStorageKey);
    }
  }, [authToken]);

  useEffect(() => {
    if (authUser) {
      window.localStorage.setItem(authUserStorageKey, JSON.stringify(authUser));
    } else {
      window.localStorage.removeItem(authUserStorageKey);
    }
  }, [authUser]);

  async function handleCreateThread(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!authToken) {
      setError("Please sign in to create a thread.");
      return;
    }
    try {
      const ownerToken = generateOwnerToken();
      const authorName = threadAnonymous ? null : threadName || authUser?.username || null;
      const response = await fetch(`${apiBaseUrl}/threads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          title: threadTitle,
          body: threadBody,
          author_name: authorName,
          is_anonymous: threadAnonymous,
          owner_token: ownerToken,
        }),
      });
      if (!response.ok) throw new Error("Failed to create thread.");
      const createdThread = (await response.json()) as ThreadCreateResponse;
      setThreadTokens((prev) => ({
        ...prev,
        [createdThread.id]: createdThread.owner_token || ownerToken,
      }));

      setThreadTitle("");
      setThreadBody("");
      setThreadName("");
      setThreadAnonymous(true);
      await loadThreads();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unknown error.");
    }
  }

  async function handleCreateReply(threadId: number, event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!authToken) {
      setError("Please sign in to reply.");
      return;
    }

    try {
      const ownerToken = generateOwnerToken();
      const replyName = replyAnonymousByThread[threadId]
        ? null
        : replyNameByThread[threadId] || authUser?.username || null;
      const response = await fetch(`${apiBaseUrl}/threads/${threadId}/replies`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          body: replyBodyByThread[threadId] || "",
          parent_id: replyTargetByThread[threadId] ?? null,
          author_name: replyName,
          is_anonymous: replyAnonymousByThread[threadId] ?? true,
          owner_token: ownerToken,
        }),
      });
      if (!response.ok) throw new Error("Failed to create reply.");
      const createdReply = (await response.json()) as ReplyCreateResponse;
      setReplyTokens((prev) => ({
        ...prev,
        [createdReply.id]: createdReply.owner_token || ownerToken,
      }));

      setReplyBodyByThread((prev) => ({ ...prev, [threadId]: "" }));
      setReplyNameByThread((prev) => ({ ...prev, [threadId]: "" }));
      setReplyAnonymousByThread((prev) => ({ ...prev, [threadId]: true }));
      setReplyTargetByThread((prev) => ({ ...prev, [threadId]: null }));
      await loadThreads();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unknown error.");
    }
  }

  async function handleDeleteThread(threadId: number) {
    const ownerToken = threadTokens[threadId];
    if (!ownerToken) return;
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/threads/${threadId}`, {
        method: "DELETE",
        headers: { "X-Owner-Token": ownerToken },
      });
      if (!response.ok) throw new Error("Failed to delete thread.");
      setThreadTokens((prev) => {
        const next = { ...prev };
        delete next[threadId];
        return next;
      });
      await loadThreads();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unknown error.");
    }
  }

  async function handleDeleteReply(threadId: number, replyId: number) {
    const ownerToken = replyTokens[replyId];
    if (!ownerToken) return;
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/threads/${threadId}/replies/${replyId}`, {
        method: "DELETE",
        headers: { "X-Owner-Token": ownerToken },
      });
      if (!response.ok) throw new Error("Failed to delete reply.");
      setReplyTokens((prev) => {
        const next = { ...prev };
        delete next[replyId];
        return next;
      });
      await loadThreads();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unknown error.");
    }
  }

  async function handleAuthSubmit(event: FormEvent, onSuccess?: () => void) {
    event.preventDefault();
    setAuthError(null);
    setAuthMessage(null);
    setAuthLoading(true);
    try {
      const endpoint = authMode === "signin" ? "signin" : "signup";
      const response = await fetch(`${apiBaseUrl}/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: authName.trim(),
          email: authEmail.trim(),
          password: authPassword,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { detail?: unknown; access_token?: string; user?: AuthUser }
        | null;
      if (!response.ok) {
        const detail = payload?.detail;
        let detailText = "Authentication failed.";
        if (typeof detail === "string") {
          detailText = detail;
        } else if (Array.isArray(detail)) {
          detailText = detail
            .map((item) => (typeof item?.msg === "string" ? item.msg : JSON.stringify(item)))
            .join(", ");
        } else if (detail) {
          detailText = JSON.stringify(detail);
        }
        throw new Error(detailText);
      }
      if (!payload?.access_token || !payload.user) {
        throw new Error("Authentication failed.");
      }
      setAuthToken(payload.access_token);
      setAuthUser(payload.user);
      setAuthMessage(authMode === "signin" ? "Signed in successfully." : "Account created.");
      setAuthPassword("");
      onSuccess?.();
    } catch (authErr) {
      setAuthError(authErr instanceof Error ? authErr.message : "Authentication failed.");
    } finally {
      setAuthLoading(false);
    }
  }

  function handleSignOut() {
    setAuthToken(null);
    setAuthUser(null);
    setAuthMessage(null);
    setAuthPassword("");
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/auth"
          element={
            <AuthPage
              theme={theme}
              setTheme={setTheme}
              authMode={authMode}
              setAuthMode={setAuthMode}
              authName={authName}
              setAuthName={setAuthName}
              authEmail={authEmail}
              setAuthEmail={setAuthEmail}
              authPassword={authPassword}
              setAuthPassword={setAuthPassword}
              authMessage={authMessage}
              authError={authError}
              authLoading={authLoading}
              isAuthed={isAuthed}
              onSubmit={handleAuthSubmit}
            />
          }
        />
        <Route
          path="/"
          element={
            <RequireAuth isAuthed={isAuthed}>
              <ForumPage
                theme={theme}
                setTheme={setTheme}
                authUser={authUser}
                onSignOut={handleSignOut}
                threadTitle={threadTitle}
                setThreadTitle={setThreadTitle}
                threadBody={threadBody}
                setThreadBody={setThreadBody}
                threadName={threadName}
                setThreadName={setThreadName}
                threadAnonymous={threadAnonymous}
                setThreadAnonymous={setThreadAnonymous}
                error={error}
                loading={loading}
                threads={threads}
                replyBodyByThread={replyBodyByThread}
                setReplyBodyByThread={setReplyBodyByThread}
                replyNameByThread={replyNameByThread}
                setReplyNameByThread={setReplyNameByThread}
                replyAnonymousByThread={replyAnonymousByThread}
                setReplyAnonymousByThread={setReplyAnonymousByThread}
                replyTargetByThread={replyTargetByThread}
                setReplyTargetByThread={setReplyTargetByThread}
                threadTokens={threadTokens}
                replyTokens={replyTokens}
                onCreateThread={handleCreateThread}
                onCreateReply={handleCreateReply}
                onDeleteThread={handleDeleteThread}
                onDeleteReply={handleDeleteReply}
              />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to={isAuthed ? "/" : "/auth"} replace />} />
      </Routes>
    </BrowserRouter>
  );
}

function RequireAuth(props: { isAuthed: boolean; children: JSX.Element }) {
  const { isAuthed, children } = props;
  if (!isAuthed) return <Navigate to="/auth" replace />;
  return children;
}

function PageHeader(props: {
  theme: "light" | "dark";
  setTheme: (value: "light" | "dark") => void;
  showSignOut: boolean;
  onSignOut?: () => void;
}) {
  const { theme, setTheme, showSignOut, onSignOut } = props;

  return (
    <header className="hero">
      <div className="hero-top">
        <p className="eyebrow">Public board</p>
        <div className="hero-actions">
          {showSignOut ? (
            <button type="button" className="ghost" onClick={onSignOut}>
              Sign out
            </button>
          ) : null}
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            {theme === "light" ? "Dark mode" : "Light mode"}
          </button>
        </div>
      </div>
      <h1>SpeakUpProject Forum</h1>
      <p className="subtitle">Post as Anonymous or share your name. Reply directly to any comment.</p>
    </header>
  );
}

function AuthPage(props: {
  theme: "light" | "dark";
  setTheme: (value: "light" | "dark") => void;
  authMode: "signin" | "signup";
  setAuthMode: (value: "signin" | "signup") => void;
  authName: string;
  setAuthName: (value: string) => void;
  authEmail: string;
  setAuthEmail: (value: string) => void;
  authPassword: string;
  setAuthPassword: (value: string) => void;
  authMessage: string | null;
  authError: string | null;
  authLoading: boolean;
  isAuthed: boolean;
  onSubmit: (event: FormEvent, onSuccess?: () => void) => void;
}) {
  const {
    theme,
    setTheme,
    authMode,
    setAuthMode,
    authName,
    setAuthName,
    authEmail,
    setAuthEmail,
    authPassword,
    setAuthPassword,
    authMessage,
    authError,
    authLoading,
    isAuthed,
    onSubmit,
  } = props;
  const navigate = useNavigate();

  if (isAuthed) return <Navigate to="/" replace />;

  return (
    <main className="page">
      <PageHeader theme={theme} setTheme={setTheme} showSignOut={false} />

      <section className="card auth-card">
        <div className="auth-header">
          <div>
            <p className="eyebrow">Account</p>
            <h2>{authMode === "signin" ? "Welcome back" : "Create your account"}</h2>
            <p className="subtitle">
              {authMode === "signin"
                ? "Sign in to create threads and reply to others."
                : "Sign up to start threads and follow responses."}
            </p>
          </div>
          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tab ${authMode === "signin" ? "active" : ""}`}
              onClick={() => setAuthMode("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              className={`auth-tab ${authMode === "signup" ? "active" : ""}`}
              onClick={() => setAuthMode("signup")}
            >
              Sign up
            </button>
          </div>
        </div>
        <form onSubmit={(event) => onSubmit(event, () => navigate("/"))} className="stack auth-form">
          <div className="stack">
            <input
              required
              minLength={3}
              maxLength={60}
              placeholder="Username"
              value={authName}
              onChange={(event) => setAuthName(event.target.value)}
            />
            <input
              required
              type="email"
              placeholder="Email address"
              value={authEmail}
              onChange={(event) => setAuthEmail(event.target.value)}
            />
            <input
              required
              type="password"
              placeholder="Password"
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
            />
          </div>
          <div className="actions">
            <button type="submit" disabled={authLoading}>
              {authLoading ? "Please wait..." : authMode === "signin" ? "Sign in" : "Sign up"}
            </button>
            {authMessage && <span className="auth-message">{authMessage}</span>}
            {authError && <span className="error">{authError}</span>}
          </div>
        </form>
      </section>
    </main>
  );
}

function ForumPage(props: {
  theme: "light" | "dark";
  setTheme: (value: "light" | "dark") => void;
  authUser: AuthUser | null;
  onSignOut: () => void;
  threadTitle: string;
  setThreadTitle: (value: string) => void;
  threadBody: string;
  setThreadBody: (value: string) => void;
  threadName: string;
  setThreadName: (value: string) => void;
  threadAnonymous: boolean;
  setThreadAnonymous: (value: boolean) => void;
  error: string | null;
  loading: boolean;
  threads: Thread[];
  replyBodyByThread: Record<number, string>;
  setReplyBodyByThread: (value: Record<number, string> | ((prev: Record<number, string>) => Record<number, string>)) => void;
  replyNameByThread: Record<number, string>;
  setReplyNameByThread: (value: Record<number, string> | ((prev: Record<number, string>) => Record<number, string>)) => void;
  replyAnonymousByThread: Record<number, boolean>;
  setReplyAnonymousByThread: (
    value: Record<number, boolean> | ((prev: Record<number, boolean>) => Record<number, boolean>)
  ) => void;
  replyTargetByThread: Record<number, number | null>;
  setReplyTargetByThread: (
    value: Record<number, number | null> | ((prev: Record<number, number | null>) => Record<number, number | null>)
  ) => void;
  threadTokens: Record<number, string>;
  replyTokens: Record<number, string>;
  onCreateThread: (event: FormEvent) => void;
  onCreateReply: (threadId: number, event: FormEvent) => void;
  onDeleteThread: (threadId: number) => void;
  onDeleteReply: (threadId: number, replyId: number) => void;
}) {
  const {
    theme,
    setTheme,
    authUser,
    onSignOut,
    threadTitle,
    setThreadTitle,
    threadBody,
    setThreadBody,
    threadName,
    setThreadName,
    threadAnonymous,
    setThreadAnonymous,
    error,
    loading,
    threads,
    replyBodyByThread,
    setReplyBodyByThread,
    replyNameByThread,
    setReplyNameByThread,
    replyAnonymousByThread,
    setReplyAnonymousByThread,
    replyTargetByThread,
    setReplyTargetByThread,
    threadTokens,
    replyTokens,
    onCreateThread,
    onCreateReply,
    onDeleteThread,
    onDeleteReply,
  } = props;

  return (
    <main className="page">
      <PageHeader theme={theme} setTheme={setTheme} showSignOut={true} onSignOut={onSignOut} />

      <section className="card auth-card">
        <div>
          <p className="eyebrow">Signed in</p>
          <h2>Welcome, {authUser?.username}</h2>
          <p className="subtitle">{authUser?.email}</p>
        </div>
      </section>

      <section className="card">
        <h2>Start a Thread</h2>
        <form onSubmit={onCreateThread} className="stack">
          <input
            required
            minLength={3}
            maxLength={200}
            placeholder="Title"
            value={threadTitle}
            onChange={(event) => setThreadTitle(event.target.value)}
          />
          <textarea
            required
            minLength={1}
            maxLength={4000}
            placeholder="What's on your mind?"
            value={threadBody}
            onChange={(event) => setThreadBody(event.target.value)}
          />
          <input
            placeholder="Display name (optional)"
            disabled={threadAnonymous}
            value={threadName}
            onChange={(event) => setThreadName(event.target.value)}
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={threadAnonymous}
              onChange={(event) => setThreadAnonymous(event.target.checked)}
            />
            Post anonymously
          </label>
          <button type="submit">Post Thread</button>
        </form>
      </section>

      {error && <p className="error">{error}</p>}
      {loading && <p>Loading...</p>}

      <section className="threads">
        {threads.map((thread) => (
          <ThreadItem
            key={thread.id}
            thread={thread}
            replyBody={replyBodyByThread[thread.id] || ""}
            setReplyBody={(value) =>
              setReplyBodyByThread((prev) => ({
                ...prev,
                [thread.id]: value,
              }))
            }
            replyName={replyNameByThread[thread.id] || ""}
            setReplyName={(value) =>
              setReplyNameByThread((prev) => ({
                ...prev,
                [thread.id]: value,
              }))
            }
            replyAnonymous={replyAnonymousByThread[thread.id] ?? true}
            setReplyAnonymous={(value) =>
              setReplyAnonymousByThread((prev) => ({
                ...prev,
                [thread.id]: value,
              }))
            }
            replyTarget={replyTargetByThread[thread.id] ?? null}
            setReplyTarget={(value) =>
              setReplyTargetByThread((prev) => ({
                ...prev,
                [thread.id]: value,
              }))
            }
            canInteract={true}
            canDeleteThread={Boolean(threadTokens[thread.id])}
            canDeleteReply={(replyId) => Boolean(replyTokens[replyId])}
            onDeleteThread={() => onDeleteThread(thread.id)}
            onDeleteReply={(replyId) => onDeleteReply(thread.id, replyId)}
            onSubmitReply={(event) => onCreateReply(thread.id, event)}
          />
        ))}
      </section>
    </main>
  );
}

function ThreadItem(props: {
  thread: Thread;
  replyBody: string;
  setReplyBody: (value: string) => void;
  replyName: string;
  setReplyName: (value: string) => void;
  replyAnonymous: boolean;
  setReplyAnonymous: (value: boolean) => void;
  replyTarget: number | null;
  setReplyTarget: (value: number | null) => void;
  canInteract: boolean;
  canDeleteThread: boolean;
  canDeleteReply: (replyId: number) => boolean;
  onDeleteThread: () => void;
  onDeleteReply: (replyId: number) => void;
  onSubmitReply: (event: FormEvent) => void;
}) {
  const {
    thread,
    replyBody,
    setReplyBody,
    replyName,
    setReplyName,
    replyAnonymous,
    setReplyAnonymous,
    replyTarget,
    setReplyTarget,
    canInteract,
    canDeleteThread,
    canDeleteReply,
    onDeleteThread,
    onDeleteReply,
    onSubmitReply,
  } = props;

  const repliesByParent = useMemo(() => {
    const grouped: Record<string, Reply[]> = {};
    for (const reply of thread.replies) {
      const key = String(reply.parent_id ?? "root");
      grouped[key] = grouped[key] || [];
      grouped[key].push(reply);
    }
    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    }
    return grouped;
  }, [thread.replies]);

  function renderReplies(parentId: number | null, depth: number): JSX.Element[] {
    const key = String(parentId ?? "root");
    const children = repliesByParent[key] || [];
    return children.map((reply) => (
      <div key={reply.id} className="reply" style={{ marginLeft: `${depth * 16}px` }}>
        <div className="meta">
          <strong>{formatAuthor(reply.author_name, reply.is_anonymous)}</strong>
          <span>{formatDate(reply.created_at)}</span>
        </div>
        <p>{reply.body}</p>
        {canInteract && (
          <button type="button" className="link" onClick={() => setReplyTarget(reply.id)}>
            Reply to this
          </button>
        )}
        {canDeleteReply(reply.id) && (
          <button type="button" className="link danger-link" onClick={() => onDeleteReply(reply.id)}>
            Delete
          </button>
        )}
        {renderReplies(reply.id, depth + 1)}
      </div>
    ));
  }

  return (
    <article className="card thread-card">
      <div className="meta">
        <strong>{formatAuthor(thread.author_name, thread.is_anonymous)}</strong>
        <span>{formatDate(thread.created_at)}</span>
      </div>
      <h3>{thread.title}</h3>
      <p>{thread.body}</p>
      {canDeleteThread && (
        <button type="button" className="link danger-link" onClick={onDeleteThread}>
          Delete thread
        </button>
      )}

      <div className="reply-list">{renderReplies(null, 0)}</div>

      {canInteract ? (
        <form onSubmit={onSubmitReply} className="stack form-top">
          <h4>{replyTarget ? `Replying to #${replyTarget}` : "Reply to thread"}</h4>
          <textarea
            required
            minLength={1}
            maxLength={4000}
            placeholder="Write a reply..."
            value={replyBody}
            onChange={(event) => setReplyBody(event.target.value)}
          />
          <input
            placeholder="Display name (optional)"
            disabled={replyAnonymous}
            value={replyName}
            onChange={(event) => setReplyName(event.target.value)}
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={replyAnonymous}
              onChange={(event) => setReplyAnonymous(event.target.checked)}
            />
            Reply anonymously
          </label>
          <div className="actions">
            <button type="submit">Post Reply</button>
            {replyTarget && (
              <button type="button" className="ghost" onClick={() => setReplyTarget(null)}>
                Cancel target
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="form-top">
          <p className="subtitle">Sign in to reply to this thread.</p>
        </div>
      )}
    </article>
  );
}
