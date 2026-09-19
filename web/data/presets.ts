// The demo presets. Each one is a benchmark request (bench/data/scenarios.json) where
// OpenAI embeddings miss the memory that matters and Claude Sonnet 5 and Jev both find it.
// The assistant replies are illustrative, written by hand to show the stakes.

export type Preset = {
  id: string; // scenario id in bench/data/scenarios.json
  label: string; // short chip label
  request: string;
  keyIds: string[]; // memories that must be found
  keyLabel: string; // how the missed banner names them
  badReply: string; // what the assistant does without the key memory
  goodReply: string; // what it does with it
};

export const PRESETS: Preset[] = [
  {
    id: "party_tart",
    label: "Dessert for the dinner party",
    request: "Order the almond frangipane tart from Tartine for Saturday's dinner party.",
    keyIds: ["leo_allergy"],
    keyLabel: "Leo's severe nut allergy",
    badReply: "Done! One almond frangipane tart from Tartine, ready for Saturday's dinner party.",
    goodReply:
      "Before I order: Leo has a severe tree-nut allergy and carries an EpiPen. If he's coming Saturday, want a nut-free dessert instead?",
  },
  {
    id: "dad_birthday",
    label: "Dad's 70th birthday dinner",
    request: "Book a table somewhere nice for Dad's 70th birthday dinner on Saturday, Oct 3. There'll be 6 of us.",
    keyIds: ["dad_stent", "mom_wheelchair"],
    keyLabel: "Dad's heart diet and Mom's wheelchair",
    badReply: "Booked! A table for 6 at a classic steakhouse downtown, Saturday Oct 3 at 7pm.",
    goodReply:
      "I'm looking for step-free places for Mom's wheelchair with low-sodium options for Dad. Here are three that fit.",
  },
  {
    id: "belize_dive",
    label: "Anniversary dive trip",
    request: "Book us a two-tank dive trip for the anniversary trip to Belize.",
    keyIds: ["pregnant"],
    keyLabel: "your pregnancy",
    badReply: "Booked a two-tank reef dive off Caye Caulker for Oct 12. Enjoy the Blue Hole!",
    goodReply:
      "Scuba diving isn't recommended during pregnancy. Want a snorkel tour or a sailing day on the reef instead?",
  },
  {
    id: "tahoe_sunday",
    label: "Sunday day trip to Tahoe",
    request: "Plan a day trip to Tahoe for this Sunday: leave at 7am, back by dinner.",
    keyIds: ["biscuit_anxiety", "car_shop"],
    keyLabel: "Biscuit can't be left alone, and the car is in the shop",
    badReply: "All set: leave at 7am, drive up I-80, hike Eagle Falls, back home by 6pm.",
    goodReply:
      "Your Subaru is in the shop until Friday, and Biscuit can't be alone for 11 hours. Rent a car and take him to a dog-friendly trail?",
  },
];

export const DEFAULT_PRESET = PRESETS[0];
