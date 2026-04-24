import express from 'express';

const app = express();
app.use(express.json());

// Mock Data
let hcmBalances = {};
let currentChaosMode = 'random'; // random, 500, silent-fail, success

app.post('/hcm/admin/set-chaos', (req, res) => {
  currentChaosMode = req.body.mode;
  res.json({ success: true, mode: currentChaosMode });
});

app.get('/hcm/balance/:employeeId/:locationId', (req, res) => {
  const { employeeId, locationId } = req.params;
  const balance = hcmBalances[`${employeeId}-${locationId}`] || 0;
  res.json({ employeeId, locationId, balance });
});

app.post('/hcm/deduct', (req, res) => {
  const { employeeId, locationId, days } = req.body;
  let random = Math.random();
  if (currentChaosMode === '500') {
    random = 0.05;
  } else if (currentChaosMode === 'silent-fail') {
    random = 0.15;
  } else if (currentChaosMode === 'success') {
    random = 0.5;
  }
  
  if (random < 0.10) {
    // 10% chance: 500 Error
    return res.status(500).json({ error: 'Internal HCM Error' });
  } 
  
  if (random < 0.20) {
    // 10% chance: Silent Failure (200 OK, but didn't deduct)
    return res.status(200).json({ success: true, message: 'Silently failed to deduct' });
  }

  // 80% chance: Success Happy Path
  const key = `${employeeId}-${locationId}`;
  if (hcmBalances[key] !== undefined) {
    hcmBalances[key] -= days;
  } else {
    hcmBalances[key] = -days; 
  }

  res.status(200).json({ success: true });
});

// Admin endpoint for tests to inject balance
app.post('/hcm/admin/set-balance', (req, res) => {
  const { employeeId, locationId, balance } = req.body;
  hcmBalances[`${employeeId}-${locationId}`] = balance;
  res.json({ success: true, balance });
});

let server;
export const startServer = (port = 3001) => {
  return new Promise((resolve) => {
    server = app.listen(port, () => {
      console.log(`HCM Mock Server running on port ${port}`);
      resolve(server);
    });
  });
};

export const stopServer = () => {
  if (server) server.close();
}

// Start if called directly
if (require.main === module) {
  const directPort = Number(process.env.HCM_PORT ?? 3001);
  startServer(directPort);
}
