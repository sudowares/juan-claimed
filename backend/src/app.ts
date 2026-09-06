// Express app setup only — no `.listen()` here. Split out from index.ts so the exact same
// app can be reused two ways: index.ts calls .listen() on it for local dev (Docker Compose),
// while api/index.ts exports it as-is for Vercel's serverless Node.js runtime (which invokes
// the Express app directly as a request handler per invocation, never calling .listen()).
import "dotenv/config";
import cors from "cors";
import express from "express";
import { healthRouter } from "./routes/health.routes.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { logger } from "./utils/logger.js";
import { fieldRouter } from "./routes/field.route.js";
import { ruleGroupRouter } from "./routes/ruleGroup.route.js";
import { dynamicRuleGroupRouter } from "./routes/fieldRuleGroup.route.js";
import { fieldHierarchyRouter } from "./routes/fieldHierarchy.route.js";
import { fieldLookupRouter } from "./routes/fieldLookup.route.js";
import { groupRouter } from "./routes/group.route.js";
import { userRouter } from "./routes/user.route.js";
import { benefitRouter } from "./routes/benefit.routes.js";
import { scopeRouter } from "./routes/scope.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { attachmentUploadRouter } from "./routes/attachmentUpload.routes.js";
import { benefitBundleRouter } from "./routes/benefitBundle.routes.js";
import { fieldAnswerRouter } from "./routes/fieldAnswer.route.js";
import { translateRouter } from "./routes/translate.routes.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.originalUrl}`);
  next();
});

app.use("/health", healthRouter);
app.use("/api/fields", fieldRouter);
app.use("/api/rule-groups", ruleGroupRouter);
app.use("/api/dynamic-rule-groups", dynamicRuleGroupRouter);
app.use("/api/field-hierarchies", fieldHierarchyRouter);
app.use("/api", fieldLookupRouter);
app.use("/api/field-answers", fieldAnswerRouter);

app.use("/api/groups", groupRouter);
app.use("/api/users", userRouter);
app.use("/api/benefits", benefitRouter);
app.use("/api/scopes", scopeRouter);
app.use("/api/auth", authRouter);
app.use("/api/attachments", attachmentUploadRouter);
app.use("/api/benefit-bundles", benefitBundleRouter);
app.use("/api/translate", translateRouter);

// No router matched. Without this, Express's built-in finalhandler answers with an HTML
// error page, so a frontend calling response.json() on every API response throws a parse
// error instead of surfacing "not found" — which is what a typo'd path or a stale deployed
// client actually hits. Mounted after every router, before the error handler.
app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    message: "The requested endpoint does not exist.",
    error: `Cannot ${req.method} ${req.originalUrl}`,
    errorCode: "ROUTE_NOT_FOUND",
    data: null,
  });
});

app.use(errorHandler);

export default app;
