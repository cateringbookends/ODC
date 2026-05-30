const ODC_DATA = {
  events: [
    {
      id: 1,
      externalId: "EVT-2026-001",
      name: "Grand Royal Wedding Reception",
      date: "2026-06-28",
      location: "Elysian Palace, Bangalore",
      pax: 350,
      days: 2,
      costPerPax: 1500,
      status: "planning"
    },
    {
      id: 2,
      externalId: "EVT-2026-002",
      name: "Tech Summit Corporate Dinner",
      date: "2026-07-12",
      location: "Ritz-Carlton, Bangalore",
      pax: 150,
      days: 1,
      costPerPax: 2200,
      status: "open"
    },
    {
      id: 3,
      externalId: "EVT-2026-003",
      name: "Annual Gala Dinner",
      date: "2026-05-30",
      location: "Lakeside Pavilion, Hyderabad",
      pax: 500,
      days: 1,
      costPerPax: 1800,
      status: "open"
    }
  ],
  defaults: {
    gstRate: 0.05,
    advanceRate: 0.5,
    decorRate: 0.05,
    staffCostPerDay: 1000
  }
};

ODC_DATA.events = ODC_DATA.events.map((event) => ({
  ...event,
  totalBilling: event.pax * event.days * event.costPerPax
}));

window.ODC_DATA = ODC_DATA;
