PGP for Crypto 2025 year-end email

Files
- pgp_2025_year_end.html: HTML email content
- pgp_2025_year_end.txt: plain-text fallback
- template_content.json: payload for aws sesv2 create-email-template
- message.json: payload for aws sesv2 send-email (Simple)
- bulk_entries.json: sample bulk recipient list

AWS auth (update to your environment)
- aws sso login --profile <profile>
- export AWS_PROFILE=<profile>
- export AWS_REGION=<region>

Regenerate JSON after edits

jq -Rs \
  --arg subj "PGP* for Crypto - 2025 Year-End Note" \
  --rawfile text pgp_2025_year_end.txt \
  '{Subject:$subj, Html:., Text:$text}' \
  pgp_2025_year_end.html > template_content.json

jq -Rs \
  --arg subj "PGP* for Crypto - 2025 Year-End Note" \
  '{Simple:{Subject:{Data:$subj,Charset:"UTF-8"},Body:{Html:{Data:.,Charset:"UTF-8"}}}}' \
  pgp_2025_year_end.html > message.json

Create or update the SES template

aws sesv2 create-email-template \
  --template-name PGP_2025_Year_End \
  --template-content file://template_content.json

If the template already exists, update it instead:

aws sesv2 update-email-template \
  --template-name PGP_2025_Year_End \
  --template-content file://template_content.json

Send a test with the template

aws sesv2 send-email \
  --from-email-address '"PGP for Crypto" <admin@pgpforcrypto.org>' \
  --destination 'ToAddresses=["person@example.com"]' \
  --content '{
    "Template": {
      "TemplateName": "PGP_2025_Year_End",
      "TemplateData": "{}"
    }
  }'

Send with Simple content (no template)

aws sesv2 send-email \
  --from-email-address '"PGP for Crypto" <admin@pgpforcrypto.org>' \
  --destination 'ToAddresses=["person@example.com"]' \
  --content file://message.json

Send bulk with the template

aws sesv2 send-bulk-email \
  --from-email-address '"PGP for Crypto" <admin@pgpforcrypto.org>' \
  --default-content '{
    "Template": {
      "TemplateName": "PGP_2025_Year_End",
      "TemplateData": "{}"
    }
  }' \
  --bulk-email-entries file://bulk_entries.json
