// Patch for /update-password endpoint
app.post('/update-password', async (req, res) => {
  try {
    const { userId, newPassword } = req.body;

    if (!userId || !newPassword) {
      return res.status(400).json({ error: 'Missing userId or newPassword' });
    }

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;

    if (!url || !key) {
      console.error(`[${new Date().toISOString()}] Missing Supabase credentials from environment`);
      return res.status(500).json({ error: 'Missing Supabase configuration' });
    }

    console.log(`[${new Date().toISOString()}] [/update-password] Updating password for user: ${userId}`);
    
    // Используем Supabase Admin API для обновления пароля пользователя
    const adminUrl = `${url}/auth/v1/admin/users/${userId}`;
    const response = await fetch(adminUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        password: newPassword
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[${new Date().toISOString()}] [/update-password] Admin API call failed:`, errorText);
      return res.status(response.status).json({
        success: false,
        error: 'Admin API call failed',
        details: errorText
      });
    }

    const result = await response.json();
    console.log(`[${new Date().toISOString()}] [/update-password] Password updated successfully for user: ${userId}`);
    
    return res.status(200).json({
      success: true,
      message: 'Password updated successfully',
      user: result
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [/update-password] Error:`, error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to update password',
      details: error.message
    });
  }
});
