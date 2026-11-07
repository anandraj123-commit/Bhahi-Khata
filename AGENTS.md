# Development validation policy

The project owner has postponed automated testing until the final development phase.

Until the owner explicitly requests testing:
- Do not create or modify automated test cases, test fixtures, mocks, or test infrastructure.
- Do not create `.test.*` or `.spec.*` files or add testing frameworks/dependencies.
- Do not run automated test suites or add coverage requirements.
- Use typechecks, syntax checks, import inspection, application builds and git diff checks when useful.
- Preserve payment verification, webhook security, authorization, operational health checks, environment validation and migrations.
- The testing deployment environment is an application environment, not an automated-test suite; preserve its configuration and operational scripts.
