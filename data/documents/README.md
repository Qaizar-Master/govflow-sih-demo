# Synthetic demo documents

Every file here is **fabricated for demonstration**. None is a real certificate, and none
relates to a real person or a real issuing authority. Each is clearly marked
`SYNTHETIC SPECIMEN` in its body.

They exist so the document pipeline can be demonstrated offline: they carry a text layer,
so extraction works without an OCR engine or a network connection.

During the demo, upload these from the citizen portal:

- `income-certificate-CIT-1001.txt` → *Income certificate*
- `education-certificate-CIT-1001.txt` → *Bonafide / education certificate*

CIT-1001 (Rohan Prajapati) is the seeded citizen with no application, so he is the account
to use for a live end-to-end run.

The seed regenerates these files, so deleting one is harmless:

```bash
npm run db:seed -- --force            # local
docker compose exec api npx tsx prisma/seed.ts --force   # docker
```
