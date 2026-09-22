import { PROVIDER_HOSTS } from "./hosts.js";
import type {
  BoundaryRecognizer,
  ProviderRecognizer,
  ResourceMethods,
  UnsupportedSdkList,
} from "./types.js";

/**
 * Built-in recognizers. Each is data: replacing or adding one needs no change
 * to inventory, resolution, flow or binding.
 *
 * The declaration shapes below were taken from the public type declarations
 * of the named packages (openai 4.24–4.104, @anthropic-ai/sdk 0.18, ai 4–5,
 * @ai-sdk/* providers). The unit tests exercise them against SYNTHETIC
 * declaration files that mirror those shapes (see `test/fixtures/synthetic-sdks/`);
 * the real-repository benchmark (`benchmarks/real-repos/`) exercises them
 * against the published packages installed with scripts disabled.
 */

/** OpenAI v4.104.0 core.RequestOptions and resources' { body, ...options }. */
const OPENAI_REQUEST_OPTIONS = {
  argument: 1,
  bodyOverride: "body",
  sentProperties: ["headers", "query", "idempotencyKey"],
  localProperties: ["timeout", "maxRetries", "signal"],
} as const;

const OPENAI_RESOURCES: ResourceMethods = {
  pathPrefix: "resources/",
  excludeMembers: ["withResponse", "asResponse", "constructor"],
  optionsParameters: ["options"],
  kinds: [
    {
      resource:
        "^(beta\\.)?chat\\.completions\\.(create|parse|stream|runTools|runFunctions)$",
      kind: "inference",
      modelProperty: "model",
    },
    {
      resource: "^responses\\.(create|parse|stream)$",
      kind: "inference",
      modelProperty: "model",
    },
    {
      resource: "^completions\\.create$",
      kind: "inference",
      modelProperty: "model",
    },
    {
      resource: "^embeddings\\.create$",
      kind: "embedding",
      modelProperty: "model",
    },
    {
      resource:
        "^beta\\.threads\\.(runs\\.(create|createAndPoll|createAndStream|stream|submitToolOutputs|submitToolOutputsAndPoll|submitToolOutputsStream)|createAndRun|createAndRunPoll|createAndRunStream)$",
      kind: "inference",
      modelProperty: "model",
    },
    {
      resource:
        "^(audio\\.(transcriptions|translations|speech)|images\\.(generate|edit|createVariation)|moderations)\\.create$|^images\\.(generate|edit|createVariation)$",
      kind: "inference",
      modelProperty: "model",
    },
    {
      resource:
        "^(files\\.create|uploads\\.|(beta\\.)?vectorStores\\.(files\\.(create|createAndPoll|upload|uploadAndPoll)|fileBatches\\.)|beta\\.threads\\.messages\\.create$|containers\\.files\\.create)",
      kind: "data_upload",
      modelProperty: null,
    },
  ],
  defaultKind: "management",
};

export const OPENAI_RECOGNIZER: ProviderRecognizer = {
  kind: "provider",
  id: "openai",
  version: "3",
  provider: "openai",
  defaultDeployment: "managed_api",
  defaultHost: "api.openai.com",
  defaultProvider: "openai",
  packages: ["openai"],
  clients: [
    { owners: ["OpenAI"], endpointOptions: ["baseURL"] },
    {
      owners: ["AzureOpenAI"],
      endpointOptions: ["baseURL", "endpoint"],
      endpointRequired: true,
      provider: "azure_openai",
    },
  ],
  operations: [
    {
      id: "chat.completions.create",
      owners: ["Completions"],
      member: "create",
      kind: "inference",
      payloadArgument: 0,
      requestOptions: OPENAI_REQUEST_OPTIONS,
      modelProperty: "model",
      callPath: ["chat", "completions", "create"],
    },
    {
      id: "responses.create",
      owners: ["Responses"],
      member: "create",
      kind: "inference",
      payloadArgument: 0,
      requestOptions: OPENAI_REQUEST_OPTIONS,
      modelProperty: "model",
      callPath: ["responses", "create"],
    },
    {
      id: "embeddings.create",
      owners: ["Embeddings"],
      member: "create",
      kind: "embedding",
      payloadArgument: 0,
      requestOptions: OPENAI_REQUEST_OPTIONS,
      modelProperty: "model",
      callPath: ["embeddings", "create"],
    },
  ],
  resourceMethods: OPENAI_RESOURCES,
  environmentVariables: [
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "AZURE_OPENAI_ENDPOINT",
    "AZURE_OPENAI_API_KEY",
  ],
  basis:
    "openai npm package declarations: class OpenAI and AzureOpenAI; every method of a class under resources/ (chat.completions, responses, embeddings, files, uploads, vectorStores, beta.assistants/threads, audio, images, moderations)",
};

export const ANTHROPIC_RECOGNIZER: ProviderRecognizer = {
  kind: "provider",
  id: "anthropic",
  version: "1",
  provider: "anthropic",
  defaultDeployment: "managed_api",
  defaultHost: "api.anthropic.com",
  defaultProvider: "anthropic",
  packages: ["@anthropic-ai/sdk"],
  clients: [{ owners: ["Anthropic"], endpointOptions: ["baseURL"] }],
  operations: [],
  resourceMethods: {
    pathPrefix: "resources/",
    excludeMembers: ["withResponse", "asResponse", "constructor"],
    optionsParameters: ["options"],
    kinds: [
      {
        resource:
          "^(beta\\.)?messages\\.(create|stream|parse)$|^completions\\.create$",
        kind: "inference",
        modelProperty: "model",
      },
      {
        resource: "^(beta\\.)?messages\\.batches\\.create$",
        kind: "inference",
        modelProperty: null,
      },
      {
        resource: "^(beta\\.)?files\\.upload$",
        kind: "data_upload",
        modelProperty: null,
      },
    ],
    defaultKind: "management",
  },
  environmentVariables: ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"],
  basis:
    "@anthropic-ai/sdk declarations: class Anthropic; every method of a class under resources/ (messages, completions, beta, models, files)",
};

export const OLLAMA_RECOGNIZER: ProviderRecognizer = {
  kind: "provider",
  id: "ollama",
  version: "2",
  provider: "ollama",
  defaultDeployment: "local",
  defaultHost: "127.0.0.1",
  defaultProvider: "ollama",
  packages: ["ollama"],
  clients: [{ owners: ["Ollama", "Ollama$1"], endpointOptions: ["host"] }],
  operations: [
    {
      id: "chat",
      owners: ["Ollama", "Ollama$1"],
      member: "chat",
      kind: "inference",
      payloadArgument: 0,
      modelProperty: "model",
      callPath: ["ollama", "chat"],
    },
    {
      id: "generate",
      owners: ["Ollama", "Ollama$1"],
      member: "generate",
      kind: "inference",
      payloadArgument: 0,
      modelProperty: "model",
      callPath: ["ollama", "generate"],
    },
    {
      id: "embed",
      owners: ["Ollama", "Ollama$1"],
      member: "embed",
      kind: "embedding",
      payloadArgument: 0,
      modelProperty: "model",
      callPath: ["ollama", "embed"],
    },
  ],
  environmentVariables: ["OLLAMA_HOST"],
  basis:
    "ollama npm package declaration shape (class Ollama with chat, generate, embed; default export instance)",
};

const factory = (
  pkg: string,
  provider: string | null,
  defaultHost: string | null,
  create: readonly string[],
  extra: {
    deployment?: "managed_api" | "local";
    endpointOptions?: readonly string[];
    endpointRequired?: boolean;
  } = {},
) => ({
  package: pkg,
  provider,
  deployment: extra.deployment ?? ("managed_api" as const),
  defaultHost,
  create,
  endpointOptions: extra.endpointOptions ?? ["baseURL"],
  ...(extra.endpointRequired === true ? { endpointRequired: true } : {}),
});

export const AI_SDK_RECOGNIZER: ProviderRecognizer = {
  kind: "provider",
  id: "ai-sdk",
  version: "1",
  provider: "vercel-ai-sdk",
  defaultDeployment: "managed_api",
  defaultHost: null,
  defaultProvider: null,
  packages: ["ai"],
  clients: [],
  operations: [
    ...["generateText", "streamText", "generateObject", "streamObject"].map(
      (member) => ({
        id: member,
        owners: [],
        member,
        kind: "inference" as const,
        payloadArgument: 0,
        modelProperty: "model",
        modelValue: "provider_factory" as const,
        callPath: [member],
      }),
    ),
    ...["embed", "embedMany"].map((member) => ({
      id: member,
      owners: [],
      member,
      kind: "embedding" as const,
      payloadArgument: 0,
      modelProperty: "model",
      modelValue: "provider_factory" as const,
      callPath: [member],
    })),
  ],
  modelFactories: [
    factory("@ai-sdk/openai", "openai", "api.openai.com", ["createOpenAI"]),
    factory("@ai-sdk/azure", "azure_openai", null, ["createAzure"], {
      endpointOptions: ["baseURL", "resourceName"],
      endpointRequired: true,
    }),
    factory("@ai-sdk/anthropic", "anthropic", "api.anthropic.com", [
      "createAnthropic",
    ]),
    factory("@ai-sdk/google", "google", "generativelanguage.googleapis.com", [
      "createGoogleGenerativeAI",
    ]),
    factory("@ai-sdk/mistral", "mistral", "api.mistral.ai", ["createMistral"]),
    factory("@ai-sdk/groq", "groq", "api.groq.com", ["createGroq"]),
    factory("@ai-sdk/xai", "xai", "api.x.ai", ["createXai"]),
    factory("@ai-sdk/deepseek", "deepseek", "api.deepseek.com", [
      "createDeepSeek",
    ]),
    factory("@ai-sdk/togetherai", "together", "api.together.xyz", [
      "createTogetherAI",
    ]),
    factory("@ai-sdk/fireworks", "fireworks", "api.fireworks.ai", [
      "createFireworks",
    ]),
    factory("@ai-sdk/cohere", "cohere", "api.cohere.com", ["createCohere"]),
    factory("@ai-sdk/perplexity", "perplexity", "api.perplexity.ai", [
      "createPerplexity",
    ]),
    factory(
      "@ai-sdk/amazon-bedrock",
      "bedrock",
      null,
      ["createAmazonBedrock"],
      {
        endpointOptions: ["baseURL", "region"],
      },
    ),
    factory(
      "@ai-sdk/openai-compatible",
      null,
      null,
      ["createOpenAICompatible"],
      {
        endpointRequired: true,
      },
    ),
    factory("ollama-ai-provider", "ollama", "127.0.0.1", ["createOllama"], {
      deployment: "local",
    }),
    factory("ollama-ai-provider-v2", "ollama", "127.0.0.1", ["createOllama"], {
      deployment: "local",
    }),
  ],
  environmentVariables: [],
  basis:
    "ai package declarations (generateText, streamText, generateObject, streamObject, embed, embedMany) and @ai-sdk/* provider factories (callable providers and create* functions)",
};

export const HTTP_AI_RECOGNIZER: ProviderRecognizer = {
  kind: "provider",
  id: "http",
  version: "1",
  provider: "http",
  defaultDeployment: "managed_api",
  defaultHost: null,
  defaultProvider: null,
  packages: [],
  clients: [],
  operations: [
    {
      id: "http.request",
      owners: [],
      member: "fetch",
      kind: "management",
      payloadArgument: 1,
      sentArguments: [0],
      modelProperty: "model",
      callPath: ["fetch"],
    },
  ],
  http: {
    globals: ["fetch"],
    hosts: PROVIDER_HOSTS.filter((entry) => entry.deployment === "managed_api"),
  },
  environmentVariables: [],
  basis:
    "global fetch (default library or @types/node) with a literal URL, or a template with a literal origin, whose host is a known AI provider",
};

export const QUEUE_BOUNDARY: BoundaryRecognizer = {
  kind: "boundary",
  id: "queues",
  version: "1",
  boundary: "queue",
  packages: [
    "bullmq",
    "bull",
    "amqplib",
    "kafkajs",
    "@aws-sdk/client-sqs",
    "@google-cloud/pubsub",
  ],
  ambientModules: [],
  globals: [],
};

export const DATABASE_BOUNDARY: BoundaryRecognizer = {
  kind: "boundary",
  id: "databases",
  version: "1",
  boundary: "database",
  packages: [
    "pg",
    "mysql2",
    "mongodb",
    "mongoose",
    "ioredis",
    "redis",
    "@prisma/client",
    "better-sqlite3",
    "sqlite3",
    "knex",
    "drizzle-orm",
  ],
  ambientModules: [],
  globals: [],
};

export const EVENT_AND_PROCESS_BOUNDARY: BoundaryRecognizer = {
  kind: "boundary",
  id: "node-events-and-processes",
  version: "1",
  boundary: "event",
  packages: [],
  ambientModules: [
    "events",
    "node:events",
    "worker_threads",
    "node:worker_threads",
    "child_process",
    "node:child_process",
  ],
  globals: ["postMessage", "BroadcastChannel", "MessagePort", "Worker"],
};

export const NETWORK_BOUNDARY: BoundaryRecognizer = {
  kind: "boundary",
  id: "network",
  version: "2",
  boundary: "network",
  packages: ["axios", "got", "node-fetch", "undici", "ky"],
  ambientModules: [
    "http",
    "node:http",
    "https",
    "node:https",
    "net",
    "node:net",
    "http2",
    "node:http2",
  ],
  globals: ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"],
};

/**
 * together-ai 0.40: a stainless-generated client shaped like openai's, whose
 * every resource method is discovered from `resources/`.
 */
export const TOGETHER_RECOGNIZER: ProviderRecognizer = {
  kind: "provider",
  id: "together",
  version: "1",
  provider: "together",
  defaultDeployment: "managed_api",
  defaultHost: "api.together.ai",
  defaultProvider: "together",
  packages: ["together-ai"],
  clients: [{ owners: ["Together"], endpointOptions: ["baseURL"] }],
  operations: [],
  resourceMethods: {
    pathPrefix: "resources/",
    excludeMembers: ["withResponse", "asResponse", "constructor"],
    optionsParameters: ["options"],
    kinds: [
      {
        resource:
          "^(chat\\.completions\\.(create|stream|parse|runTools)|(completions|videos|rerank|audio\\.(speech|transcriptions|translations))\\.create|images\\.generate)$",
        kind: "inference",
        modelProperty: "model",
      },
      {
        resource: "^embeddings\\.create$",
        kind: "embedding",
        modelProperty: "model",
      },
      {
        resource: "^(files\\.upload|models\\.upload)$",
        kind: "data_upload",
        modelProperty: null,
      },
    ],
    defaultKind: "management",
  },
  environmentVariables: ["TOGETHER_API_KEY", "TOGETHER_BASE_URL"],
  basis:
    "together-ai npm package declarations: class Together; every method of a class under resources/ (chat.completions, completions, embeddings, images, videos, rerank, audio, files, models, endpoints, fine-tuning, batches)",
};

export const UNSUPPORTED_AI_SDKS: UnsupportedSdkList = {
  kind: "unsupported_sdks",
  id: "unsupported-ai-sdks",
  version: "3",
  packages: [
    "@google/generative-ai",
    "@google/genai",
    "@mistralai/mistralai",
    "cohere-ai",
    "groq-sdk",
    "replicate",
    "@huggingface/inference",
    "@aws-sdk/client-bedrock-runtime",
    "langchain",
    "llamaindex",
    "@openai/agents",
    "@openai/agents-core",
    "@openai/agents-openai",
    "@openai/agents-realtime",
  ],
  scopes: ["@langchain"],
};

export const PROVIDER_RECOGNIZERS: readonly ProviderRecognizer[] = [
  AI_SDK_RECOGNIZER,
  ANTHROPIC_RECOGNIZER,
  HTTP_AI_RECOGNIZER,
  OLLAMA_RECOGNIZER,
  OPENAI_RECOGNIZER,
  TOGETHER_RECOGNIZER,
];

export const BOUNDARY_RECOGNIZERS: readonly BoundaryRecognizer[] = [
  DATABASE_BOUNDARY,
  EVENT_AND_PROCESS_BOUNDARY,
  NETWORK_BOUNDARY,
  QUEUE_BOUNDARY,
];
