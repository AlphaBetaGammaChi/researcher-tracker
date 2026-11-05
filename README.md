# Researcher Tracker

A single-page tool for tracking your research output: papers, journals and publishers, co-authors (with a network map), key interests, a publication timeline, and every paper that cites your work.

## Use it

Open `index.html` in a browser. There is no build step and no server.

1. **Profile & sync:** enter your name and ORCID iD, then click *Sync from OpenAlex*. Papers, citation counts, co-authors, topics and citing papers are pulled from [OpenAlex](https://openalex.org).
2. **Google Scholar:** Scholar has no public API. Export your list as BibTeX from Scholar and paste it into *Import from BibTeX*.
3. **Backup:** export a JSON backup regularly. Data is stored only in the browser you use.

## Privacy

Nothing is uploaded. Your data lives in the browser's localStorage. A sync sends only your ORCID iD, OpenAlex ID or name to the OpenAlex API.

## Publish with GitHub Pages

Push this folder to a GitHub repository, then go to *Settings → Pages*, choose the `main` branch and the root folder. The tracker is served at `https://<user>.github.io/<repo>/`.

## Known limits

- OpenAlex sometimes splits one author into several records or misses works. Check the results against your ORCID record.
- Citation counts come from OpenAlex and can differ from Google Scholar.
