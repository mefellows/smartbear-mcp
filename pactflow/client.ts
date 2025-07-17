import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from "../common/info.js";
import { Client } from "../common/types.js";

// Type definitions for PactFlow AI API
export type GenerationLanguage = 
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
  private headers: { "Authorization": string; "Content-Type": string, "User-Agent": string };
  private aiBaseUrl: string;

  constructor(private token: string, private baseUrl: string) {
    this.headers = {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": `${MCP_SERVER_NAME}/${MCP_SERVER_VERSION}`,
    };
    this.aiBaseUrl = `${this.baseUrl}/api/ai`;
  }

  async generate(body: GenerationInput): Promise<GenerationResponse> {
    console.log("Generating Pact tests with body:", JSON.stringify(body, null, 2));
    console.log("sending request to PactFlow AI API at", this.aiBaseUrl + "/generate");
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
    return await this.pollForCompletion<GenerationResponse>(submission, "Generation");
  }

  async checkStatus(statusUrl: string): Promise<{ status: number; isComplete: boolean }> {
    const response = await fetch(statusUrl, {
      method: "HEAD",
      headers: this.headers,
    });

    return {
      status: response.status,
      isComplete: response.status === 200
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

  private async pollForCompletion<T>(submission: SubmissionResponse, operationName: string): Promise<T> {
    const startTime = Date.now();
    const timeout = 60000; // 60 seconds
    const pollInterval = 1000; // 1 second

    while (Date.now() - startTime < timeout) {
      const statusCheck = await this.checkStatus(submission.status_url);
      
      if (statusCheck.isComplete) {
        // Operation is complete, get the result
        return await this.getResult<T>(submission.result_url);
      }
      
      if (statusCheck.status !== 202) {
        throw new Error(`${operationName} failed with status: ${statusCheck.status}`);
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    
    throw new Error(`${operationName} timed out after ${timeout / 1000} seconds`);
  }

  async getProviderStates(provider: string): Promise<ProviderStatesResponse> {
    const encodedProvider = encodeURIComponent(provider);
    const response = await fetch(`${this.baseUrl}/pacts/provider/${encodedProvider}/provider-states`, {
      method: "GET",
      headers: this.headers,
    });

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
        language: z.enum([
          "typescript", 
          "java",
          "golang",
          "dotnet",
          "kotlin",
          "swift",
          "php"
        ]).optional().describe("Target language for the generated Pact tests. If not provided, will be inferred from other inputs."),
        requestResponse: z.object({
          request: z.object({
            filename: z.string().optional().describe("Optional filename for the request (helps with context)"),
            body: z.string().describe("Request content/payload - can be HTTP request, JSON, or any format describing the request"),
            language: z.string().optional().describe("Language hint for better parsing (e.g., 'json', 'http', 'yaml')")
          }),
          response: z.object({
            filename: z.string().optional().describe("Optional filename for the response (helps with context)"),
            body: z.string().describe("Response content/payload - can be HTTP response, JSON, or any format describing the response"),
            language: z.string().optional().describe("Language hint for better parsing (e.g., 'json', 'http', 'yaml')")
          })
        }).optional().describe("Direct request/response pair for a specific interaction. Use this when you have concrete examples of API requests and responses"),
        code: z.array(z.object({
          filename: z.string().optional().describe("Filename (helps identify file type and context)"),
          body: z.string().describe("Complete file contents - client code, models, test files, etc."),
          language: z.string().optional().describe("Programming language (e.g., 'javascript', 'java', 'python') for better analysis")
        })).optional().describe("Collection of source code files to analyze and extract API interactions from. Include client code, data models, existing tests, or any code that makes API calls"),
        openapi: z.object({
          document: z.object({
            openapi: z.string().describe("OpenAPI version (e.g., '3.0.0')"),
            paths: z.record(z.record(z.any())).describe("OpenAPI paths object containing all API endpoints"),
            components: z.record(z.record(z.any())).optional().describe("OpenAPI components section (schemas, responses, etc.)")
          }).passthrough().describe("The complete OpenAPI document describing the API"),
          matcher: z.object({
            path: z.string().optional().describe("Path pattern to match specific endpoints (e.g., '/users/{id}', '/users/*', '/users/**'). Supports glob patterns: ? (single char), * (excluding /), ** (including /)"),
            methods: z.array(z.enum(["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE"])).optional().describe("HTTP methods to include (e.g., ['GET', 'POST']). If not specified, all methods are matched"),
            statusCodes: z.array(z.union([z.number(), z.string()])).optional().describe("Response status codes to include (e.g., [200, '2XX', 404]). Use 'X' as wildcard (e.g., '2XX' for 200-299). Defaults to successful codes (2XX)"),
            operationId: z.string().optional().describe("OpenAPI operation ID to match (e.g., 'getUserById', 'get*'). Supports glob patterns")
          }).required().describe("REQUIRED: Matcher to specify which endpoints from the OpenAPI document to generate tests for. At least one matcher field must be provided")
        }).optional().describe("OpenAPI document for generating tests from API specifications. IMPORTANT: When providing an OpenAPI document, the matcher field is REQUIRED to specify which endpoints to generate tests for. This filters the relevant interactions from potentially large OpenAPI documents"),
        additionalInstructions: z.string().optional().describe("Optional free-form instructions to guide the generation process (e.g., 'Focus on error scenarios', 'Include authentication headers', 'Use specific test framework patterns')"),
        testTemplate: z.object({
          filename: z.string().optional().describe("Template filename for context"),
          body: z.string().describe("Existing test template or example to use as a basis for the generated tests"),
          language: z.string().optional().describe("Template language/framework (e.g., 'javascript', 'junit', 'jest')")
        }).optional().describe("Optional test template to use as a basis for generation. Helps ensure generated tests follow your specific patterns, frameworks, and coding standards")
      },
      async (args: GenerationInput, _extra) => {
        const response = await this.generate(args);
        return {
          content: [{ type: "text", text: JSON.stringify(response) }],
        };
      },
    );

    server.tool(
      "list_provider_states",
      "List all provider states for a given provider, showing which consumers use each state.",
      {
        provider: z.string().describe("The name of the provider to get states for")
      },
      async (args: { provider: string }, _extra) => {
        const response = await this.getProviderStates(args.provider);
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      },
    );

    server.tool(
      "review_pact",
      "Review Pact tests to align with best practices and identify potential improvements. The output includes suggestions and diffs that may be applied to the test to apply the recommendations.",
      {
        pactTests: z.object({
          filename: z.string().optional().describe("File name for the Pact tests"),
          body: z.string().describe("Content of the Pact test file"),
          language: z.string().optional().describe("Language hint for the Pact tests")
        }).describe("Primary Pact tests that need to be reviewed"),
        code: z.array(z.object({
          filename: z.string().optional().describe("File name"),
          body: z.string().describe("File contents"),
          language: z.string().optional().describe("Language hint")
        })).optional().describe("Collection of code files for context during review"),
        userInstructions: z.string().optional().describe("Optional instructions providing additional context or specifying areas of focus"),
        errorMessages: z.array(z.string()).optional().describe("Optional error output from failed contract test runs"),
        openapi: z.object({
          document: z.object({
            openapi: z.string().describe("OpenAPI version"),
            paths: z.record(z.record(z.any())).describe("OpenAPI paths"),
            components: z.record(z.record(z.any())).optional().describe("OpenAPI components")
          }).passthrough(),
          matcher: z.object({
            path: z.string().optional().describe("Path pattern to match"),
            methods: z.array(z.enum(["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE"])).optional().describe("HTTP methods to match"),
            statusCodes: z.array(z.union([z.number(), z.string()])).optional().describe("Status codes to match"),
            operationId: z.string().optional().describe("OpenAPI operation ID to match")
          })
        }).optional().describe("OpenAPI document with endpoint matcher for review context")
      },
      async (args: RefineInput, _extra) => {
        const response = await this.reviewPact(args);
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      },
    );
  }
}
