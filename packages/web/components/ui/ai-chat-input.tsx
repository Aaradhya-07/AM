"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import styles from "./ai-chat-input.module.css";

type IconName =
  "up" | "mic" | "stop" | "plus" | "close" | "layers" | "bars" | "chevron";

function Icon({ name, level = 3 }: { name: IconName; level?: number }) {
  const shapes: Record<IconName, React.ReactNode> = {
    up: <path d="M9 14V4m-4 4 4-4 4 4" />,
    mic: (
      <>
        <rect x="7" y="2" width="4" height="9" rx="2" />
        <path d="M4.5 8.5a4.5 4.5 0 0 0 9 0M9 13v3" />
      </>
    ),
    stop: (
      <rect x="5" y="5" width="8" height="8" rx="1.5" fill="currentColor" />
    ),
    plus: <path d="M9 3.5v11m-5.5-5.5h11" />,
    close: <path d="m5 5 8 8m0-8-8 8" />,
    layers: (
      <>
        <path d="m9 2.5 6.5 3.8L9 10 2.5 6.3 9 2.5Z" />
        <path d="m2.5 10 6.5 3.8 6.5-3.8m-13 3.5L9 17l6.5-3.5" />
      </>
    ),
    bars: (
      <>
        <path d="M4 14v-3" />
        <path d="M9 14V8" opacity={level >= 2 ? 1 : 0.35} />
        <path d="M14 14V4" opacity={level >= 3 ? 1 : 0.35} />
      </>
    ),
    chevron: <path d="m5 7 4 4 4-4" />,
  };

  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {shapes[name]}
    </svg>
  );
}

interface Attachment {
  id: string;
  file: File;
  url: string;
}

interface SpeechResult {
  [index: number]: { transcript: string };
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<SpeechResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechWindow = Window & {
  SpeechRecognition?: new () => BrowserSpeechRecognition;
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
};

export interface PromptOption {
  id: string;
  label: string;
}

export interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (
    value: string,
    meta: { model: string; effort: string; attachments: File[] },
  ) => void;
  models: readonly [PromptOption, ...PromptOption[]];
  efforts: readonly [PromptOption, ...PromptOption[]];
  placeholder?: string;
  minLength: number;
  maxLength: number;
}

const maxAttachments = 6;
const maxImageBytes = 10 * 1024 * 1024;

export function PromptInput({
  value,
  onChange,
  onSubmit,
  models,
  efforts,
  placeholder = "Describe what you want to build…",
  minLength,
  maxLength,
}: PromptInputProps) {
  const [model, setModel] = useState(models[0].id);
  const [effortIndex, setEffortIndex] = useState(
    Math.min(1, efforts.length - 1),
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const promptId = useId();
  const modelMenuId = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachButton = useRef<HTMLButtonElement>(null);
  const gallery = useRef<HTMLDialogElement>(null);
  const attachmentUrls = useRef(new Set<string>());
  const modelPicker = useRef<HTMLDivElement>(null);
  const modelButton = useRef<HTMLButtonElement>(null);
  const recognition = useRef<BrowserSpeechRecognition | null>(null);
  const effort = efforts[effortIndex] ?? efforts[0];
  const selectedModel =
    models.find((option) => option.id === model) ?? models[0];

  useEffect(() => {
    const input = textarea.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${input.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    const urls = attachmentUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
      if (recognition.current) {
        recognition.current.onend = null;
        recognition.current.onerror = null;
        recognition.current.onresult = null;
        recognition.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (preview) gallery.current?.showModal();
  }, [preview]);

  useEffect(() => {
    if (!modelOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !modelPicker.current?.contains(event.target)
      ) {
        setModelOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [modelOpen]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (listening) return;
    const idea = value.trim();
    if (idea.length < minLength) {
      setMessage(`Enter at least ${minLength} characters to continue.`);
      textarea.current?.focus();
      return;
    }
    setMessage("");
    onSubmit(idea, {
      model: selectedModel.id,
      effort: effort.id,
      attachments: attachments.map(({ file }) => file),
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function addAttachments(files: FileList) {
    const next = Array.from(files)
      .filter(
        (file) => file.type.startsWith("image/") && file.size <= maxImageBytes,
      )
      .slice(0, maxAttachments - attachments.length)
      .map((file) => {
        const url = URL.createObjectURL(file);
        attachmentUrls.current.add(url);
        return { id: url, file, url };
      });
    setAttachments([...attachments, ...next]);
    setMessage(
      next.length < files.length
        ? "You can add up to six images, each 10 MB or smaller."
        : "",
    );
  }

  function removeAttachment(attachment: Attachment) {
    URL.revokeObjectURL(attachment.url);
    attachmentUrls.current.delete(attachment.url);
    setAttachments((current) =>
      current.filter(({ id }) => id !== attachment.id),
    );
    setMessage("");
    attachButton.current?.focus();
  }

  function startDictation() {
    const speechWindow = window as SpeechWindow;
    const SpeechRecognition =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMessage(
        "Voice input is unavailable in this browser. You can type your idea below.",
      );
      textarea.current?.focus();
      return;
    }

    const session = new SpeechRecognition();
    const original = value.trimEnd();
    session.continuous = true;
    session.interimResults = true;
    session.onresult = ({ results }) => {
      const speech = Array.from(
        results,
        (result) => result[0]?.transcript ?? "",
      )
        .join("")
        .trim();
      onChange(
        [original, speech].filter(Boolean).join(" ").slice(0, maxLength),
      );
    };
    session.onend = () => {
      recognition.current = null;
      setListening(false);
      textarea.current?.focus();
    };
    session.onerror = ({ error }) => {
      setMessage(
        error === "not-allowed"
          ? "Microphone access was denied. You can type your idea below."
          : "Voice input ended. You can continue typing.",
      );
    };

    try {
      session.start();
      recognition.current = session;
      setListening(true);
      setMessage("");
    } catch {
      setMessage("Could not start voice input. You can type your idea below.");
    }
  }

  return (
    <>
      <form className={styles.composer} onSubmit={submit} noValidate>
        {attachments.length > 0 && (
          <ul className={styles.attachments} aria-label="Image previews">
            {attachments.map((attachment) => (
              <li className={styles.attachment} key={attachment.id}>
                <button
                  type="button"
                  className={styles.thumbnail}
                  aria-label={`Preview ${attachment.file.name}`}
                  onClick={() => setPreview(attachment)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- Browser-local image preview. */}
                  <img src={attachment.url} alt="" />
                </button>
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={`Remove ${attachment.file.name}`}
                  onClick={() => removeAttachment(attachment)}
                >
                  <Icon name="close" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.surface}>
          <label className="sr-only" htmlFor={promptId}>
            Project idea
          </label>
          <textarea
            ref={textarea}
            id={promptId}
            rows={2}
            value={value}
            placeholder={placeholder}
            maxLength={maxLength}
            readOnly={listening}
            onChange={(event) => {
              onChange(event.target.value);
              setMessage("");
            }}
            onKeyDown={handleKeyDown}
          />
          <div className={styles.toolbar}>
            <div className={styles.options}>
              <div
                className={styles.modelPicker}
                ref={modelPicker}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget))
                    setModelOpen(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && modelOpen) {
                    setModelOpen(false);
                    modelButton.current?.focus();
                  }
                }}
              >
                <button
                  type="button"
                  className={styles.option}
                  ref={modelButton}
                  aria-label={`Planning model: ${selectedModel.label}`}
                  aria-expanded={modelOpen}
                  aria-controls={modelMenuId}
                  onClick={() => setModelOpen(!modelOpen)}
                >
                  <Icon name="layers" />
                  <span key={selectedModel.id}>{selectedModel.label}</span>
                  <Icon name="chevron" />
                </button>
                <div
                  id={modelMenuId}
                  className={styles.modelMenu}
                  role="group"
                  aria-label="Planning model"
                  hidden={!modelOpen}
                >
                  {models.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={selectedModel.id === option.id}
                      onClick={() => {
                        setModel(option.id);
                        setModelOpen(false);
                        modelButton.current?.focus();
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className={styles.option}
                aria-label={`Planning effort: ${effort.label}. Change effort`}
                onClick={() =>
                  setEffortIndex((effortIndex + 1) % efforts.length)
                }
              >
                <Icon name="bars" level={effortIndex + 1} />
                <span key={effort.id}>{effort.label}</span>
              </button>
            </div>
            <div className={styles.actions}>
              {listening && (
                <span className={styles.listening} role="status">
                  <i />
                  Listening
                </span>
              )}
              <button
                ref={attachButton}
                type="button"
                className={styles.attach}
                aria-label="Add image preview"
                onClick={() => fileInput.current?.click()}
                disabled={attachments.length >= maxAttachments}
              >
                <Icon name="plus" />
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept="image/*"
                hidden
                onChange={(event) => {
                  if (event.target.files?.length)
                    addAttachments(event.target.files);
                  event.target.value = "";
                }}
              />
              {listening ? (
                <button
                  type="button"
                  className={styles.send}
                  aria-label="Stop dictation"
                  onClick={() => recognition.current?.stop()}
                >
                  <Icon name="stop" />
                </button>
              ) : value.trim() ? (
                <button
                  type="submit"
                  className={styles.send}
                  aria-label="Continue to planner"
                >
                  <Icon name="up" />
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.send}
                  aria-label="Use voice input"
                  onClick={startDictation}
                >
                  <Icon name="mic" />
                </button>
              )}
            </div>
          </div>
        </div>
        {message && (
          <p className={styles.message} role="status">
            {message}
          </p>
        )}
        {attachments.length > 0 && (
          <p className={styles.message}>
            Images are previewed here. Describe any details you want the planner
            to use.
          </p>
        )}
      </form>
      {preview && (
        <dialog
          ref={gallery}
          className={styles.gallery}
          aria-label={`Preview of ${preview.file.name}`}
          onClose={() => setPreview(null)}
          onClick={(event) => {
            if (event.target === event.currentTarget)
              event.currentTarget.close();
          }}
        >
          <figure>
            <button
              type="button"
              aria-label="Close preview"
              onClick={() => gallery.current?.close()}
            >
              <Icon name="close" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element -- Browser-local image preview. */}
            <img src={preview.url} alt={preview.file.name} />
            <figcaption>{preview.file.name}</figcaption>
          </figure>
        </dialog>
      )}
    </>
  );
}
