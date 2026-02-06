import { FormEvent, useEffect, useMemo, useState } from "react";

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
    void loadThreads();
  }, []);

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

  async function handleCreateThread(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const ownerToken = generateOwnerToken();
      const response = await fetch(`${apiBaseUrl}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: threadTitle,
          body: threadBody,
          author_name: threadName || null,
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

    try {
      const ownerToken = generateOwnerToken();
      const response = await fetch(`${apiBaseUrl}/threads/${threadId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: replyBodyByThread[threadId] || "",
          parent_id: replyTargetByThread[threadId] ?? null,
          author_name: (replyNameByThread[threadId] || "").trim() || null,
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

  function handleAuthSubmit(event: FormEvent) {
    event.preventDefault();
    setAuthMessage(
      authMode === "signin"
        ? "Sign-in submitted (demo only)."
        : "Sign-up submitted (demo only)."
    );
    setAuthPassword("");
  }

  return (
    <main className="page">
      <header className="hero">
        <div className="hero-top">
          <p className="eyebrow">Public board</p>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme((prev) => (prev === "light" ? "dark" : "light"))}
          >
            {theme === "light" ? "Dark mode" : "Light mode"}
          </button>
        </div>
        <h1>SpeakUpProject Forum</h1>
        <p className="subtitle">Post as Anonymous or share your name. Reply directly to any comment.</p>
      </header>

      <section className="card auth-card">
        <div className="auth-header">
          <div>
            <p className="eyebrow">Account</p>
            <h2>{authMode === "signin" ? "Welcome back" : "Create your account"}</h2>
            <p className="subtitle">
              {authMode === "signin"
                ? "Sign in to manage your posts and notifications."
                : "Sign up to save your threads and follow replies."}
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
        <form onSubmit={handleAuthSubmit} className="stack auth-form">
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
            <button type="submit">{authMode === "signin" ? "Sign in" : "Sign up"}</button>
            {authMessage && <span className="auth-message">{authMessage}</span>}
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Start a Thread</h2>
        <form onSubmit={handleCreateThread} className="stack">
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
            canDeleteThread={Boolean(threadTokens[thread.id])}
            canDeleteReply={(replyId) => Boolean(replyTokens[replyId])}
            onDeleteThread={() => handleDeleteThread(thread.id)}
            onDeleteReply={(replyId) => handleDeleteReply(thread.id, replyId)}
            onSubmitReply={(event) => handleCreateReply(thread.id, event)}
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
        <button type="button" className="link" onClick={() => setReplyTarget(reply.id)}>
          Reply to this
        </button>
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
    </article>
  );
}
