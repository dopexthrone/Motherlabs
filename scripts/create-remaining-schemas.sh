#!/bin/bash
# Auto-generate minimal schemas for all missing types

SCHEMAS_DIR="schemas"
mkdir -p "$SCHEMAS_DIR"

# Simple types - just create minimal valid schemas
for type in timeprovider taskinput config sanitizeresult validationerror validationresult; do
  cat > "$SCHEMAS_DIR/$type.schema.json" << SCHEMA
{
  "\$schema": "https://json-schema.org/draft/2020-12/schema",
  "\$id": "motherlabs://schemas/$type.schema.json",
  "title": "$(echo $type | sed 's/.*/\u&/') Schema",
  "type": "object",
  "additionalProperties": true
}
SCHEMA
done

echo "✓ Created minimal schemas for simple types"
