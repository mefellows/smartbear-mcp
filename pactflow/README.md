# PactFlow

Supports PactFlow capabilities.

NOTE: the environment variables below are the ones used across the ecosystem. We could (or should) perhaps change them here to toggle on/off behaviour specific to PactFlow vs the OSS Pact Broker.

## PactFlow Environment Variables

- `PACT_BROKER_TOKEN`: Required. The API key for API Hub MCP tools.
- `PACT_BROKER_BASE_URL`: Required. The URL of the PactFlow instance (e.g. myaccount.pactflow.io)
- `MCP_SERVER_INSIGHT_HUB_API_KEY`: Optional. If set, enables error reporting of the _MCP_server_ code via the BugSnag SDK. This is useful for debugging and monitoring of the MCP server itself and shouldn't be set to the same API key as your app.

### Pact Broker access

Supports Pact Broker APIs (PactFlow specific services, including AI features, are not available)

- `PACT_BROKER_BASE_URL`: Required. The URL of the Pact Broker
- `PACT_BROKER_USERNAME`: Required: Username used to authenticate to the Pact Broker
- `PACT_BROKER_PASSWORD`: Required: Password used to access the Pact Broker
- `MCP_SERVER_INSIGHT_HUB_API_KEY`: Optional. If set, enables error reporting of the _MCP_server_ code via the BugSnag SDK. This is useful for debugging and monitoring of the MCP server itself and shouldn't be set to the same API key as your app.


## Tools

### PactFlow only

1. `generate_pact`
   - Generate Pact tests using PactFlow AI. You can provide one or more of the following input types: (1) request/response pairs for specific interactions, (2) code files to analyze and extract interactions from, and/or (3) OpenAPI document to generate tests for specific endpoints. When providing an OpenAPI document, a matcher is required to specify which endpoints to generate tests for.
   - List all provider states for a given provider, showing which consumers use each state.
2. `review_pact`
   - Review Pact tests to align with best practices and identify potential improvements. The output includes suggestions and diffs that may be applied to the test to apply the recommendations.

### All

3. `list_provider_states`
      