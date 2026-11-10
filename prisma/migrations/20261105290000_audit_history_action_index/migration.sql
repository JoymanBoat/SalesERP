CREATE INDEX "AuditLog_organizationId_action_createdAt_id_idx"
ON "AuditLog"("organizationId", "action", "createdAt", "id");
