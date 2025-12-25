PGP for Crypto SES email prep

Files
- pgpforcrypto_template.html: HTML template with {{firstName}} placeholder
- template_content.json: JSON payload for aws sesv2 create-email-template
- message.json: JSON payload for aws sesv2 send-email (Simple)
- bulk_entries.json: sample bulk entries for send-bulk-email

AWS auth (update to your environment)
- aws sso login --profile <profile>
- export AWS_PROFILE=<profile>
- export AWS_REGION=<region>

Quick start
1) Update pgpforcrypto_template.html and subject line.
2) Regenerate JSON payloads:

jq -Rs \
  --arg subj "PGP for Crypto Community Update" \
  --arg text "Dear {{#if firstName}}{{firstName}}{{else}}Friend{{/if}},\n(plain text fallback)" \
  '{Subject:$subj, Html:., Text:$text}' \
  pgpforcrypto_template.html > template_content.json

jq -Rs \
  --arg subj "PGP for Crypto Community Update" \
  '{Simple:{Subject:{Data:$subj,Charset:"UTF-8"},Body:{Html:{Data:.,Charset:"UTF-8"}}}}' \
  pgpforcrypto_template.html > message.json

3) Create or update the SES template:

aws sesv2 create-email-template \
  --template-name PGP_Community_Update \
  --template-content file://template_content.json

4) Send a test with the template:

aws sesv2 send-email \
  --from-email-address '"PGP for Crypto" <admin@pgpforcrypto.org>' \
  --destination 'ToAddresses=["person@example.com"]' \
  --content '{
    "Template": {
      "TemplateName": "PGP_Community_Update",
      "TemplateData": "{\"firstName\":\"Pat\"}"
    }
  }'

5) Send with Simple content (no template):

aws sesv2 send-email \
  --from-email-address '"PGP for Crypto" <admin@pgpforcrypto.org>' \
  --destination 'ToAddresses=["person@example.com"]' \
  --content file://message.json

6) Send bulk:

aws sesv2 send-bulk-email \
  --from-email-address '"PGP for Crypto" <admin@pgpforcrypto.org>' \
  --default-content '{
    "Template": {
      "TemplateName": "PGP_Community_Update",
      "TemplateData": "{\"firstName\":\"\"}"
    }
  }' \
  --bulk-email-entries file://bulk_entries.json
