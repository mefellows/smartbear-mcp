import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from "../common/info.js";
import { Client } from "../common/types.js";
import { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";

// Type definitions for PactFlow AI API
export type GenerationLanguage =
  | "javascript"
  | "typescript"
  | "java"
  | "golang"
  | "dotnet"
  | "kotlin"
  | "swift"
  | "php";

export type HttpMethod =
  | "GET"
  | "PUT"
  | "POST"
  | "DELETE"
  | "OPTIONS"
  | "HEAD"
  | "PATCH"
  | "TRACE";

export interface FileInput {
  filename?: string;
  body: string;
  language?: string;
}

export interface EndpointMatcher {
  path?: string;
  methods?: HttpMethod[];
  statusCodes?: (number | string)[];
  operationId?: string;
}

export interface OpenApi {
  openapi: string;
  paths: Record<string, Record<string, any>>;
  components?: Record<string, Record<string, any>>;
  [key: string]: any;
}

export interface OpenApiWithMatcher {
  document: OpenApi;
  matcher: EndpointMatcher;
}

export interface RequestResponsePair {
  request: FileInput;
  response: FileInput;
}

export interface GenerationInput {
  language?: GenerationLanguage;
  requestResponse?: RequestResponsePair;
  code?: FileInput[];
  openapi?: OpenApiWithMatcher;
  additionalInstructions?: string;
  testTemplate?: FileInput;
}

export interface SubmissionResponse {
  status: "accepted";
  session_id: string;
  submitted_at: string;
  status_url: string;
  result_url: string;
}

export interface GenerationStatusResponse {
  status: "processing" | "completed" | "failed";
}

export interface GenerationResponse {
  id?: string;
  code: string;
  language: string;
}

export interface ProviderState {
  consumers: string[];
  name: string;
}

export interface ProviderStatesResponse {
  providerStates: ProviderState[];
}

export interface RefineInput {
  pactTests: FileInput;
  code?: FileInput[];
  userInstructions?: string;
  errorMessages?: string[];
  openapi?: OpenApiWithMatcher;
}

export interface RefineRecommendation {
  recommendation: string;
  diff?: string;
  confidence?: number;
}

export interface RefineResponse {
  recommendations: RefineRecommendation[];
}

// Tool definitions for PactFlow AI API client
export class PactFlowClient implements Client {
  private headers: {
    Authorization: string;
    "Content-Type": string;
    "User-Agent": string;
  };
  private aiBaseUrl: string;

  constructor(private token: string, private baseUrl: string) {
    this.headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": `${MCP_SERVER_NAME}/${MCP_SERVER_VERSION}`,
    };
    this.aiBaseUrl = `${this.baseUrl}/api/ai`;
  }

  async generate(body: GenerationInput): Promise<GenerationResponse> {
    console.log(
      "Generating Pact tests with body:",
      JSON.stringify(body, null, 2)
    );
    console.log(
      "sending request to PactFlow AI API at",
      this.aiBaseUrl + "/generate"
    );
    // Submit the generation request
    const response = await fetch(`${this.aiBaseUrl}/generate`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const submission: SubmissionResponse = await response.json();
    console.log("Received submission response:", submission);

    console.log("Polling for generation status...");
    return await this.pollForCompletion<GenerationResponse>(
      submission,
      "Generation"
    );
  }

  async checkStatus(
    statusUrl: string
  ): Promise<{ status: number; isComplete: boolean }> {
    const response = await fetch(statusUrl, {
      method: "HEAD",
      headers: this.headers,
    });

    return {
      status: response.status,
      isComplete: response.status === 200,
    };
  }

  async getResult<T>(resultUrl: string): Promise<T> {
    const response = await fetch(resultUrl, {
      method: "GET",
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  private async pollForCompletion<T>(
    submission: SubmissionResponse,
    operationName: string
  ): Promise<T> {
    const startTime = Date.now();
    const timeout = 120000; // 120 seconds
    const pollInterval = 1000; // 1 second

    while (Date.now() - startTime < timeout) {
      const statusCheck = await this.checkStatus(submission.status_url);

      if (statusCheck.isComplete) {
        // Operation is complete, get the result
        return await this.getResult<T>(submission.result_url);
      }

      if (statusCheck.status !== 202) {
        throw new Error(
          `${operationName} failed with status: ${statusCheck.status}`
        );
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(
      `${operationName} timed out after ${timeout / 1000} seconds`
    );
  }

  async getProviderStates(provider: string): Promise<ProviderStatesResponse> {
    const encodedProvider = encodeURIComponent(provider);
    const response = await fetch(
      `${this.baseUrl}/pacts/provider/${encodedProvider}/provider-states`,
      {
        method: "GET",
        headers: this.headers,
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async reviewPact(body: RefineInput): Promise<RefineResponse> {
    // Submit the review request
    const response = await fetch(`${this.aiBaseUrl}/review`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const submission: SubmissionResponse = await response.json();

    return await this.pollForCompletion<RefineResponse>(submission, "Review");
  }

  registerTools(server: McpServer): void {
    server.tool(
      "generate_pact",
      "Generate Pact tests using PactFlow AI. You can provide one or more of the following input types: (1) request/response pairs for specific interactions, (2) code files to analyze and extract interactions from, and/or (3) OpenAPI document to generate tests for specific endpoints. When providing an OpenAPI document, a matcher is required to specify which endpoints to generate tests for.",
      {
        language: z
          .enum([
            "typescript",
            "java",
            "golang",
            "dotnet",
            "kotlin",
            "swift",
            "php",
          ])
          .optional()
          .describe(
            "Target language for the generated Pact tests. If not provided, will be inferred from other inputs."
          ),
        requestResponse: z
          .object({
            request: z.object({
              filename: z
                .string()
                .optional()
                .describe(
                  "Optional filename for the request (helps with context)"
                ),
              body: z
                .string()
                .describe(
                  "Request content/payload - can be HTTP request, JSON, or any format describing the request"
                ),
              language: z
                .string()
                .optional()
                .describe(
                  "Language hint for better parsing (e.g., 'json', 'http', 'yaml')"
                ),
            }),
            response: z.object({
              filename: z
                .string()
                .optional()
                .describe(
                  "Optional filename for the response (helps with context)"
                ),
              body: z
                .string()
                .describe(
                  "Response content/payload - can be HTTP response, JSON, or any format describing the response"
                ),
              language: z
                .string()
                .optional()
                .describe(
                  "Language hint for better parsing (e.g., 'json', 'http', 'yaml')"
                ),
            }),
          })
          .optional()
          .describe(
            "Direct request/response pair for a specific interaction. Use this when you have concrete examples of API requests and responses"
          ),
        code: z
          .array(
            z.object({
              filename: z
                .string()
                .optional()
                .describe("Filename (helps identify file type and context)"),
              body: z
                .string()
                .describe(
                  "Complete file contents - client code, models, test files, etc."
                ),
              language: z
                .string()
                .optional()
                .describe(
                  "Programming language (e.g., 'javascript', 'java', 'python') for better analysis"
                ),
            })
          )
          .optional()
          .describe(
            "Collection of source code files to analyze and extract API interactions from. Include client code, data models, existing tests, or any code that makes API calls"
          ),
        openapi: z
          .object({
            document: z
              .object({
                openapi: z.string().describe("OpenAPI version (e.g., '3.0.0')"),
                paths: z
                  .record(z.record(z.any()))
                  .describe(
                    "OpenAPI paths object containing all API endpoints"
                  ),
                components: z
                  .record(z.record(z.any()))
                  .optional()
                  .describe(
                    "OpenAPI components section (schemas, responses, etc.)"
                  ),
              })
              .passthrough()
              .describe("The complete OpenAPI document describing the API"),
            matcher: z
              .object({
                path: z
                  .string()
                  .optional()
                  .describe(
                    "Path pattern to match specific endpoints (e.g., '/users/{id}', '/users/*', '/users/**'). Supports glob patterns: ? (single char), * (excluding /), ** (including /)"
                  ),
                methods: z
                  .array(
                    z.enum([
                      "GET",
                      "PUT",
                      "POST",
                      "DELETE",
                      "OPTIONS",
                      "HEAD",
                      "PATCH",
                      "TRACE",
                    ])
                  )
                  .optional()
                  .describe(
                    "HTTP methods to include (e.g., ['GET', 'POST']). If not specified, all methods are matched"
                  ),
                statusCodes: z
                  .array(z.union([z.number(), z.string()]))
                  .optional()
                  .describe(
                    "Response status codes to include (e.g., [200, '2XX', 404]). Use 'X' as wildcard (e.g., '2XX' for 200-299). Defaults to successful codes (2XX)"
                  ),
                operationId: z
                  .string()
                  .optional()
                  .describe(
                    "OpenAPI operation ID to match (e.g., 'getUserById', 'get*'). Supports glob patterns"
                  ),
              })
              .required()
              .describe(
                "REQUIRED: Matcher to specify which endpoints from the OpenAPI document to generate tests for. At least one matcher field must be provided"
              ),
          })
          .optional()
          .describe(
            "OpenAPI document for generating tests from API specifications. IMPORTANT: When providing an OpenAPI document, the matcher field is REQUIRED to specify which endpoints to generate tests for. This filters the relevant interactions from potentially large OpenAPI documents"
          ),
        additionalInstructions: z
          .string()
          .optional()
          .describe(
            "Optional free-form instructions to guide the generation process (e.g., 'Focus on error scenarios', 'Include authentication headers', 'Use specific test framework patterns')"
          ),
        testTemplate: z
          .object({
            filename: z
              .string()
              .optional()
              .describe("Template filename for context"),
            body: z
              .string()
              .describe(
                "Existing test template or example to use as a basis for the generated tests"
              ),
            language: z
              .string()
              .optional()
              .describe(
                "Template language/framework (e.g., 'javascript', 'junit', 'jest')"
              ),
          })
          .optional()
          .describe(
            "Optional test template to use as a basis for generation. Helps ensure generated tests follow your specific patterns, frameworks, and coding standards"
          ),
      },
      async (args: GenerationInput, _extra) => {
        const response = await this.generate(args);
        return {
          content: [{ type: "text", text: JSON.stringify(response) }],
        };
      }
    );

    server.tool(
      "review_pact",
      "Review Pact tests to align with best practices and identify potential improvements. The output includes suggestions and diffs that may be applied to the test to apply the recommendations.",
      {
        pactTests: z
          .object({
            filename: z
              .string()
              .optional()
              .describe("File name for the Pact tests"),
            body: z.string().describe("Content of the Pact test file"),
            language: z
              .string()
              .optional()
              .describe("Language hint for the Pact tests"),
          })
          .describe("Primary Pact tests that need to be reviewed"),
        code: z
          .array(
            z.object({
              filename: z.string().optional().describe("File name"),
              body: z.string().describe("File contents"),
              language: z.string().optional().describe("Language hint"),
            })
          )
          .optional()
          .describe("Collection of code files for context during review"),
        userInstructions: z
          .string()
          .optional()
          .describe(
            "Optional instructions providing additional context or specifying areas of focus"
          ),
        errorMessages: z
          .array(z.string())
          .optional()
          .describe("Optional error output from failed contract test runs"),
        openapi: z
          .object({
            document: z
              .object({
                openapi: z.string().describe("OpenAPI version"),
                paths: z.record(z.record(z.any())).describe("OpenAPI paths"),
                components: z
                  .record(z.record(z.any()))
                  .optional()
                  .describe("OpenAPI components"),
              })
              .passthrough(),
            matcher: z.object({
              path: z.string().optional().describe("Path pattern to match"),
              methods: z
                .array(
                  z.enum([
                    "GET",
                    "PUT",
                    "POST",
                    "DELETE",
                    "OPTIONS",
                    "HEAD",
                    "PATCH",
                    "TRACE",
                  ])
                )
                .optional()
                .describe("HTTP methods to match"),
              statusCodes: z
                .array(z.union([z.number(), z.string()]))
                .optional()
                .describe("Status codes to match"),
              operationId: z
                .string()
                .optional()
                .describe("OpenAPI operation ID to match"),
            }),
          })
          .optional()
          .describe(
            "OpenAPI document with endpoint matcher for review context"
          ),
      },
      async (args: RefineInput, _extra) => {
        const response = await this.reviewPact(args);
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }
    );

    // probably should be a resource?
    server.tool(
      "list_provider_states",
      "List all provider states for a given provider, showing which consumers use each state.",
      {
        provider: z
          .string()
          .describe("The name of the provider to get states for"),
      },
      async (args: { provider: string }, _extra) => {
        const response = await this.getProviderStates(args.provider);
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }
    );

    server.tool(
      "get_pact_consumer_test_template",
      "Get a template for a Pact consumer test.",
      {
        language: z
          .enum([
            "javascript",
            "typescript",
            "java",
            "golang",
            "dotnet",
            "kotlin",
            "swift",
            "php",
          ])
          .describe("Programming language for the consumer test template"),
      },
      async (args: { language: string }, _extra) => {
        return {
          content: [
            {
              type: "text",
              text: `
import { SpecificationVersion, PactV4, MatchersV3 } from "@pact-foundation/pact";
import { ThingAPI } from './thing'

// Extract matchers here to improve readability when used in the test
const { like } = MatchersV3;

// Top level - name of the API
describe("🧱 Thing API", () => {
  // Use the PactV4 class, and serialise the Pact as V4 Pact Specification
  const pact = new PactV4({
    consumer: "ThingConsumer",
    provider: "ThingProvider",
    spec: SpecificationVersion.SPECIFICATION_VERSION_V4,
    logLevel: "error",
  });

  // Level 2 - Describe block for the specific API endpoint
  describe("🔌 GET /thing/:id", () => {

    // Level 3 - Test block for the specific test case
    test("🧪 given a valid thing, returns 200", async () => {
      await pact
        .addInteraction()
        .given("a thing with id 1 exists")
        .uponReceiving("a request for a valid thing")
        .withRequest("GET", "/thing/1", (builder) => {
          builder.headers({ Accept: "application/json" });
        })
        .willRespondWith(200, (builder) => {
          builder.jsonBody(
            like({
              id: 1,
              name: "Thing 1",
              price: 100,
            })
          );
        })
        .executeTest(async (mockserver) => {
          const ThingAPI = new ThingAPI(mockserver.url);

          const Thing = await ThingAPI.getThingById(1);

          expect(Thing).toEqual({
            id: 1,
            name: "Some 1",
            price: 100,
          });
        });
    });
  });
};`,
            },
          ],
        };
      }
    );

    server.tool(
      "get_pact_consumer_test_instructions",
      "Get a list of best practice instructions for creating Pact consumer tests. Provides language-specific guidance, configuration examples, and best practices for writing effective consumer tests.",
      {
        language: z
          .enum([
            "javascript",
            "typescript",
            "java",
            "golang",
            "dotnet",
            "kotlin",
            "swift",
            "php",
          ])
          .describe("Programming language for the consumer test template"),
      },
      async (args: { language: string }, _extra) => {
        return {
          content: [
            {
              type: "text",
              text: `* Make sure to cover happy and non-happy paths
  * Specifically, ensure to include test cases for the positive (HTTP 200) scenario and negative scenarios, specifically the case of 400, 401... 404 if they are defined 
* Only include endpoints/properties used by the API client - do not include additional fields in the OAS that are not in the client code
  * You can check the properties used in the domain class to help make this determination
* Use the testing framework the rest of the project uses (e.g. Jest, JUnit, NUnit)
* Use the same matching functions the rest of the project uses. e.g. if the project uses jest, functions such as "toEqual" and "toBeTruthy"
* Use the most recent Pact specification/interface (e.g. PactV4 in JavaScript/TypeScript)
* Omit the comments in the template given, as these are designed to help you understand the template's structure and intent
* Remember, test all scenarios defined - 200, 400, 401 and 404`,
            },
          ],
        };
      }
    );
    server.tool(
      "get_provider_contract",
      "Get the provider application details, including OpenAPI description",
      {
        provider: z.string().describe("Provider name"),
      },
      async (args: { provider: string }, _extra) => {
        return {
          content: [
            {
              type: "text",
              text: `
openapi: 3.0.1
info:
  title: Product API
  description: Pactflow Product API demo
  version: 1.0.0
paths:
  /products:
    get:
      summary: List all products
      description: Returns all products
      operationId: getAllProducts
      responses:
        "200":
          description: successful operation
          content:
            "application/json; charset=utf-8":
              schema:
                type: "array"
                items:
                  $ref: '#/components/schemas/Product'
              examples:
                application/json:
                  value:
                    - id: "1234"
                      type: "food"
                      price: 42
                      # name: "pizza"
                      # version: "1.0.0"
                      # see https://github.com/apiaryio/dredd/issues/1430 for why
  /product/{id}:
    get:
      summary: Find product by ID
      description: Returns a single product
      operationId: getProductByID
      parameters:
      - name: id
        in: path
        description: ID of product to get
        schema:
          type: string
        required: true
        example: 10
      responses:
        "200":
          description: successful operation
          content:
            "application/json; charset=utf-8":
              schema:
                $ref: '#/components/schemas/Product'
              examples:
                application/json:
                  value:
                    id: "1234"
                    type: "food"
                    price: 42
                    # name: "pizza"
                    # version: "1.0.0"
                    # see https://github.com/apiaryio/dredd/issues/1430 for why
        "400":
          description: Invalid ID supplied
          content: {}
        "401":
          description: Product not found
          content: {}
        "404":
          description: Product not found
          content: {}
components:
  schemas:
    Product:
      type: object
      required:
        - id
        - name
        - price
      properties:
        id:
          type: string
        type:
          type: string
        name:
          type: string
        version:
          type: string
        price:
          type: number              `,
            },
          ],
        };
      }
    );

    // TODO
    // Consumer side
    // 1. Get it to download and store the instructions / templates locally (for updating and customising to the project)
    // 2. Create a set of best practice templates for each language (eventually customers can upload their own to PF)
       // Possibly allow them to specify it at prompt time?

    // Provider side
    // It wanted to use HTTP requests to setup states. This indicates it's a little out of date (Sonnet 4)
    // This indicates a similar need for basic best practice templates for people to use
    // Opportunity: customers upload their own sets of best practice templates on both consumer/provider side, as well as prompts?
       // Is this too blatantly "DIY AI"? 
    // Opportunity: fetch the provider states for the provider to use. 
       // It looks like that provider states API only works if the provider is already validated. For new contracts, it doesn't seem to work
    // Fetch a pact for this provider (if known) or create a fake/simple one based on what we know to get it working locally
    server.prompt(
      "setup_pact_project",
      "Get guidance and instructions for setting up Pact in a new project. Provides language-specific setup instructions, configuration examples, and best practices for getting started with contract testing.",
      {
        language: z
          .enum([
            "javascript",
            "typescript",
            "java",
            "golang",
            "dotnet",
            "kotlin",
            "swift",
            "php",
          ])
          .describe("Programming language for the project setup guidance"),
        role: z
          .enum(["consumer", "provider"])
          .describe("Role of the application in the Pact ecosystem"),
        provider: z
          .string()
          .describe("The name of the provider for which to set up Pact"),
      },
      async (
        args: {
          language:
            | "javascript"
            | "typescript"
            | "java"
            | "golang"
            | "dotnet"
            | "kotlin"
            | "swift"
            | "php";
          role: "consumer" | "provider";
          provider: string;
        },
        _extra
      ) =>
        args.role === "consumer"
          ? consumerMessages(args.language, args.provider)
          : providerMessages(args.language, args.provider)
    );
  }

  registerResources(server: McpServer): void {
    // Register the application details resource
    server.resource(
      "pact_application",
      new ResourceTemplate("pactflow://application/{name}", {
        list: undefined,
      }),
      async (uri, { name }) => {
        const providerContract = `openapi: 3.0.1
info:
  title: Product API
  description: Pactflow Product API demo
  version: 1.0.0
paths:
  /products:
    get:
      summary: List all products
      description: Returns all products
      operationId: getAllProducts
      responses:
        "200":
          description: successful operation
          content:
            "application/json; charset=utf-8":
              schema:
                type: "array"
                items:
                  $ref: '#/components/schemas/Product'
              examples:
                application/json:
                  value:
                    - id: "1234"
                      type: "food"
                      price: 42
                      # name: "pizza"
                      # version: "1.0.0"
                      # see https://github.com/apiaryio/dredd/issues/1430 for why
  /product/{id}:
    get:
      summary: Find product by ID
      description: Returns a single product
      operationId: getProductByID
      parameters:
      - name: id
        in: path
        description: ID of product to get
        schema:
          type: string
        required: true
        example: 10
      responses:
        "200":
          description: successful operation
          content:
            "application/json; charset=utf-8":
              schema:
                $ref: '#/components/schemas/Product'
              examples:
                application/json:
                  value:
                    id: "1234"
                    type: "food"
                    price: 42
                    # name: "pizza"
                    # version: "1.0.0"
                    # see https://github.com/apiaryio/dredd/issues/1430 for why
        "400":
          description: Invalid ID supplied
          content: {}
        "401":
          description: Product not found
          content: {}
        "404":
          description: Product not found
          content: {}
components:
  schemas:
    Product:
      type: object
      required:
        - id
        - name
        - price
      properties:
        id:
          type: string
        type:
          type: string
        name:
          type: string
        version:
          type: string
        price:
          type: number`;

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(
                {
                  application: name,
                  providerContract: providerContract,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );
  }
}

const consumerMessages = (
  language: string,
  provider: string
): GetPromptResult => {
  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `You are an a Senior Software engineer on this project and your task is to setup a best practice Pact setup in this project.
Step 1: Install the Pact dependencies for the project.

When setting up Pact, ensure you consider the following:

1. **Language** in use in the project. The current language is ${language}.
2. **Testing framework**: such as Jest, JUnit, NUnit
3. **Package Manager**: e.g. npm, yarn, Maven, Gradle
4. **Build Tool**: If separate to the package manager (e.g. make or lerna)
5. **Language Version**: The version of the ${language} may be an important consideration when installing the packages. 

If you are unsure, ask me for clarifications.`,
        },
      },
      {
        role: "assistant",
        content: {
          type: "text",
          text: `OK, i'll help you set up Pact in this project.`,
        },
      },
      {
        role: "user",
        content: {
          type: "text",
          text: `
Now you have setup the dependencies, we can move on to step 2: Create an initial set of Pact tests.

Use the following steps as a guide:

1. Identify the API client (or clients, if there are multiple)
2. Identify the simplest one to create our first Pact test from
3. Find the associated domain models, OpenAPI specification if it exists locally.`,
        },
      },
      {
        role: "assistant",
        content: {
          type: "text",
          text: `
Absolutely, let's identify the key components needed to create our first Pact test`,
        },
      },
      {
        role: "user",
        content: {
          type: "text",
          text: `
Thanks for identifying the key components. 

Using the SmartBear MCP tools, fetch a best practice template (test template) and instructions (pact.instructions.txt) for language ${language} creating Pact consumer tests. Store these files locally for future use and customisation.`,
        },
      },
      {
        role: "assistant",
        content: {
          type: "text",
          text: `
Great! I will fetch the best practice template and instructions for creating Pact consumer tests. These files will be stored locally for you to customise as needed.`,
        },
      },
      {
        role: "user",
        content: {
          type: "text",
          text: `
Before we proceed to generating the initial pact tests, if no OpenAPI specification is found locally, fetch the provider contract for ${provider} from SmartBear MCP, which will find any associated OpenAPI documents

1. Use the SmartBear MCP tools to generate the first pact, using these artifacts (pact.instructions.txt, test template, client code, test, openapi)
2. Run the tests to ensure they pass

Let the user know they should customise the instructions and template files to suit their project needs.

END
                `,
        },
      },
      {
        role: "assistant",
        content: {
          type: "text",
          text: `
Excellent! I will fetch the PactFlow application resource for the provider to find any associated OpenAPI documents. Once we have the OpenAPI document, I will generate the initial Pact tests using the provided artifacts (instructions, test template, client code, test, and OpenAPI).`,
        },
      },
    ],
  };
};
const providerMessages = (
  language: string,
  provider: string
): GetPromptResult => ({
  messages: [
    {
      role: "user",
      content: {
        type: "text",
        text: `You are an a Senior Software engineer on this project with expertise in the Pact contract testing framework. Your task is to setup a best practice Pact provider-side setup in this project.
Step 1: Install the Pact dependencies for the project.

When setting up Pact, ensure you consider the following:

1. **Language** in use in the project: ${language}
2. **Testing framework**: such as Jest, JUnit, NUnit
3. **Package Manager**: e.g. npm, yarn, Maven, Gradle
4. **Build Tool**: If separate to the package manager (e.g. make or lerna)
5. **Language Version**: The version of the ${language} may be an important consideration when installing the packages. 

If you are unsure, ask me for clarifications.`,
      },
    },
    {
      role: "assistant",
      content: {
        type: "text",
        text: `OK, I'll help you set up Pact in this project.`,
      },
    },
    {
      role: "user",
      content: {
        type: "text",
        text: `
Now you have setup the dependencies, we can move on to step 2: Creating an initial set of Pact provider verification tests.

Use the following steps as a guide:

1. Identify the class or structure that is the API provider service (e.g. the controller class in a Spring Boot application, or the main service class in a Node.js application)
2. Understand how to start the provider in a way that will expose it on a real HTTP port (it can't be a pure in-process provider - it needs to be accessible over the network)`,
      },
    },
    {
      role: "assistant",
      content: {
        type: "text",
        text: `Absolutely, let's identify the key components needed to create our provider setup`,
      },
    },
    {
      role: "user",
      content: {
        type: "text",
        text: `Thanks for identifying the key components.

Let's create a basic Pact provider verification test. There are no MCP tools for this, so we will create a basic test using the Pact library for ${language}.

Use the following steps as a guide:

1. Use the Pact library for ${language} to create a basic Pact provider verification test
2. In the test (if possible, otherwise as a separate step befoe running the tests), ensure the test starts the provider service and exposes it on a real HTTP port
3. Use the recommended consumer version selectors (be sure to update the below to match the API of the selected Pact library):

{ "mainBranch": true } - the latest version from the main branch of each consumer, as specified by the consumer's mainBranch property.
{ "deployedOrReleased": true } - all the currently deployed and currently released and supported versions of each consumer.
{ "matchingBranch": true } - the latest version from any branch of the consumer that has the same name as the current branch of the provider. Used for coordinated development between consumer and provider teams using matching feature branch names.

When pre-creating the state handlers, leave them as "todo" so the user can fill them in later. 

4. Run the tests to ensure they pass
END
                `,
      },
    },
    {
      role: "assistant",
      content: {
        type: "text",
        text: `
Great! I will help you create a basic Pact provider verification test using the Pact library for ${language}. This will include starting the provider service and exposing it on a real HTTP port, as well as using the recommended consumer version selectors.`,
      },
    },
  ],
});
