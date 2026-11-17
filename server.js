require("dotenv").config();
const express = require("express");
const cors = require("cors");
const menuRoutes = require("./routes/menu");
const orderRoutes = require("./routes/orders");
const supabase = require("./supabase");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => res.json({ message: "HYPREP Food Ordering API is running." }));
app.get("/api/test-db", async (req, res) => {
  const { data, error } = await supabase.from("menu_items").select("id").limit(1);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "Supabase database connected successfully.", data });
});
app.use("/api/menu", menuRoutes);
app.use("/api/orders", orderRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
    error: err.code === "LIMIT_FILE_SIZE" ? "Photo must not exceed 2MB." : (err.message || "Request failed.")
  });
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`HYPREP API running at http://localhost:${port}`));
