# Mrs. Grundy Lone Rock

**A lyric deep map of the Lone Rock Stockade, Grundy County, Tennessee**

*A collaboration — Thomas Macfie & Clara Coleman*

---

The Lone Rock Stockade was built in 1883 by the Tennessee Coal, Iron and Railroad Company outside Tracy City, Grundy County, Tennessee. It was the largest purpose-built private convict labor prison system in the state. Between 1884 and 1896 it held at least 3,500 individuals — over 75% categorized as Black, convicted of vagrancy, loitering, spitting — funneled through the Thirteenth Amendment's exception clause into unfree labor that rebuilt the New South economy and endowed Sewanee: The University of the South.

The site is now the Grundy Lakes Day Use Area in South Cumberland State Park. The tailings ponds are swimming holes. Coke oven arches stand colonized by ferns. The sycamores above the informal burial ground have been incorporating the dead for a hundred years.

We find morels there in spring. We have gone out to make sounds with instruments and to say the names of the men held there — the names we have.

This is a lyric deep map of that place and its afterlives. It takes the shape of the lake system it documents.

---

## The Form

**Surface — the lake view.** Nodes float as pond-bodies on a watershed map. Drag them to reshape the drainage; the threads follow. Each pond's surface holds scattered words from its poem, rearrangeable by touch.

**Descent — the geologic column.** Click a pond and the panel opens at the waterline. You sink downward through the strata: *water* (the poem) → *sediment* (the prose, the argument) → *bedrock* (the archive, document, testimony, and its silences). Depth is vertical and literal — the way a mine cuts down through rock and leaves messy ponds in its wake.

---

## Running Locally

Plain HTML/CSS/JavaScript. Loads content files dynamically, so needs a local server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

---

## Intellectual and Formal Debts

**Structural/formal:** Anna Tsing (*Feral Atlas*, *Mushroom at the End of the World*); Paisley Rekdal (*West*); Christina Sharpe (*In the Wake*); Saidiya Hartman (*Wayward Lives, Beautiful Experiments*); William Least Heat-Moon (*PrairyErth*)

**Scholarly:** Camille Westmont (*An Archaeology of Convict Leasing in the American South*); Douglas Blackmon (*Slavery by Another Name*); Michelle Alexander (*The New Jim Crow*)

**Poetic:** Ed Roberson; Claudia Rankine (*Citizen*); Layli Long Soldier (*Whereas*); Natalie Diaz (*Postcolonial Love Poem*); Mahmoud Darwish

**Collaborative sound:** JayVe Montgomery, Tennessee jazz musician and breath artist

---

## Contributing

Content lives in `content/nodes/` as Markdown files. The map lives in `data/nodes.json`. This is a collaborative work — poems are by Thomas Macfie and Clara Coleman; each node's frontmatter carries an `author` field where authorship is known. The prose in the *Geology* and *Depth* strata is, for now, placeholder scaffolding written to hold the form — it is the authors' to write or replace. Do not assume authorship; preserve it where marked.

**Author's-hand markup** (works in any stratum):
- `[[blacked out]]` → renders as a redaction bar; hover faintly reveals it (reading between the lines)
- `~~struck~~` → struck text, the visible editorial hand
- `((( )))` → an archive-silence gap, the held empty space (cf. the `(  )` in *Mine G*)
- `[clip: Headline | body text | Source · place ]` → a *Mrs. Grundy* periodical scrap, set beside the record (parataxis)

MIT licensed. Knowledge about places of forced labor cannot itself be enclosed.

---

*Built in Tennessee. The water does the rest.*
