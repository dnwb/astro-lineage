# Keep production verification offline

Production validation, build, tests, verification, and remote CI never fetch bibliographic providers or paper sources. They validate only committed canonical records and deterministic generated artifacts; V0.1 implements no source-refresh command, and external refresh/audit automation is deferred to V0.2, preventing third-party outages, rate limits, or mutable responses from changing whether a clean build passes.
