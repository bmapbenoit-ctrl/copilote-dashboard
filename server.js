/**
 * ============================================================================
 * 🚀 SERVEUR DASHBOARD COPILOTE - PLANETEBEAUTY
 * ============================================================================
 * 
 * Backend Express pour :
 * - Servir le dashboard React
 * - API Chat avec Claude
 * - Notifications email
 * - Gestion fichiers
 * 
 * @date 27 décembre 2025
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

// ============================================================================
// CONFIGURATION
// ============================================================================

const PORT = process.env.PORT || 3000;

const CONFIG = {
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://upqldbeaxuikbzohlgne.supabase.co',
  SUPABASE_KEY: process.env.SUPABASE_SERVICE_KEY || 'sb_secret_Q87xtWlfrMjtaqzgJFIJbA_jpAK2pP6',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  
  // Email config (Gmail)
  EMAIL: {
    from: 'copilote@planetebeauty.com',
    to: 'bmapbenoit@gmail.com',
    smtp: {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.GMAIL_USER || 'bmapbenoit@gmail.com',
        pass: process.env.GMAIL_APP_PASSWORD // App password from Google
      }
    }
  },
  
  // Budget limits
  DAILY_BUDGET_USD: 10,
  MAX_COST_PER_TASK: 2,
  DAILY_TOKEN_LIMIT: 500000
};

// Clients
const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

// Email transporter
let emailTransporter = null;
if (CONFIG.EMAIL.smtp.auth.pass) {
  emailTransporter = nodemailer.createTransport(CONFIG.EMAIL.smtp);
}

// ============================================================================
// EXPRESS APP
// ============================================================================

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// BUDGET TRACKING
// ============================================================================

let dailyStats = {
  date: new Date().toISOString().split('T')[0],
  tokens_used: 0,
  cost_usd: 0,
  api_calls: 0
};

function resetDailyStatsIfNeeded() {
  const today = new Date().toISOString().split('T')[0];
  if (dailyStats.date !== today) {
    dailyStats = { date: today, tokens_used: 0, cost_usd: 0, api_calls: 0 };
  }
}

function checkBudget() {
  resetDailyStatsIfNeeded();
  if (dailyStats.cost_usd >= CONFIG.DAILY_BUDGET_USD) {
    throw new Error(`Budget quotidien $${CONFIG.DAILY_BUDGET_USD} atteint`);
  }
  if (dailyStats.tokens_used >= CONFIG.DAILY_TOKEN_LIMIT) {
    throw new Error(`Limite tokens ${CONFIG.DAILY_TOKEN_LIMIT} atteinte`);
  }
}

function updateBudget(inputTokens, outputTokens) {
  const cost = (inputTokens / 1000000) * 3 + (outputTokens / 1000000) * 15;
  dailyStats.tokens_used += inputTokens + outputTokens;
  dailyStats.cost_usd += cost;
  dailyStats.api_calls += 1;
  console.log(`💰 Budget: $${dailyStats.cost_usd.toFixed(4)} / $${CONFIG.DAILY_BUDGET_USD} | Tokens: ${dailyStats.tokens_used.toLocaleString()}`);
}

// ============================================================================
// ROUTES - HEALTH
// ============================================================================

app.get('/health', async (req, res) => {
  try {
    // Test Supabase
    const { data, error } = await supabase.from('tasks').select('count').limit(1);
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        supabase: error ? 'error' : 'ok',
        anthropic: CONFIG.ANTHROPIC_API_KEY ? 'configured' : 'missing',
        email: emailTransporter ? 'configured' : 'not_configured'
      },
      budget: {
        daily_limit: CONFIG.DAILY_BUDGET_USD,
        used: dailyStats.cost_usd.toFixed(4),
        tokens_used: dailyStats.tokens_used
      },
      version: '1.0.0'
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ============================================================================
// ROUTES - CHAT WITH CLAUDE
// ============================================================================

app.post('/api/chat', async (req, res) => {
  try {
    checkBudget();
    
    const { message, history = [] } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message requis' });
    }

    if (!CONFIG.ANTHROPIC_API_KEY) {
      return res.json({ 
        response: "⚠️ L'API Claude n'est pas configurée. Ajoute ANTHROPIC_API_KEY dans les variables Railway." 
      });
    }

    // System prompt pour le copilote
    const systemPrompt = `Tu es le copilote IA de Benoît pour Planetebeauty.com, une boutique e-commerce de parfumerie de niche.

CONTEXTE BUSINESS :
- CA 2025 cible : 750 000€
- CA/jour cible : 3 000€ HT
- Clients : 29 641
- Panier moyen actuel : 177€ (objectif 200€)
- Marge brute : 41%

TES CAPACITÉS :
- Créer des tâches (à valider par Benoît avant exécution)
- Analyser les KPIs Shopify
- Proposer des optimisations
- Répondre aux questions business

RÈGLES :
1. Sois direct et concret, pas de blabla
2. Une recommandation à la fois
3. Si tu suggères une action, crée une TÂCHE à valider
4. Ne jamais inventer de chiffres - dis "je ne sais pas" si tu n'as pas l'info
5. Niveau de décision : 1-2 (lecture/analyse) = auto, 3+ = validation Benoît

RÉPONSE : Réponds en français, de manière concise et actionnable.`;

    // Build messages for Claude
    const messages = [
      ...history.slice(-10).map(m => ({
        role: m.isUser ? 'user' : 'assistant',
        content: m.content
      })),
      { role: 'user', content: message }
    ];

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Claude API error:', error);
      return res.json({ 
        response: "⚠️ Erreur API Claude. Vérifie que les crédits sont disponibles." 
      });
    }

    const data = await response.json();
    
    // Update budget tracking
    updateBudget(data.usage?.input_tokens || 0, data.usage?.output_tokens || 0);

    const assistantMessage = data.content[0]?.text || "Je n'ai pas pu générer de réponse.";

    res.json({ response: assistantMessage });

  } catch (err) {
    console.error('Chat error:', err);
    res.json({ response: `❌ Erreur: ${err.message}` });
  }
});

// ============================================================================
// ROUTES - TASKS
// ============================================================================

// Créer une tâche (suggérée, en attente de validation)
app.post('/api/tasks', async (req, res) => {
  try {
    const { title, description, task_type, decision_level = 3, estimated_cost = 0.5 } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Titre requis' });
    }

    // Vérifier budget max par tâche
    if (estimated_cost > CONFIG.MAX_COST_PER_TASK) {
      return res.status(400).json({ 
        error: `Coût estimé $${estimated_cost} dépasse la limite de $${CONFIG.MAX_COST_PER_TASK}` 
      });
    }

    // Créer la tâche en status pending_validation
    const { data, error } = await supabase.from('tasks').insert({
      title,
      description,
      task_type: task_type || 'suggested',
      status: 'pending_validation',
      decision_level,
      estimated_cost,
      source: 'dashboard',
      created_by: 'claude_copilote'
    }).select().single();

    if (error) throw error;

    // Envoyer notification email
    await sendEmailNotification({
      subject: `🔔 Nouvelle tâche à valider : ${title}`,
      body: `
        <h2>Nouvelle tâche suggérée</h2>
        <p><strong>Titre :</strong> ${title}</p>
        <p><strong>Description :</strong> ${description || 'N/A'}</p>
        <p><strong>Niveau :</strong> ${decision_level}</p>
        <p><strong>Coût estimé :</strong> $${estimated_cost}</p>
        <p><a href="https://copilote.planetebeauty.com">Valider dans le Dashboard</a></p>
      `
    });

    res.json({ success: true, task: data });

  } catch (err) {
    console.error('Create task error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Approuver une tâche
app.post('/api/tasks/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('tasks')
      .update({ 
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: 'benoit'
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, task: data });

  } catch (err) {
    console.error('Approve task error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Rejeter une tâche
app.post('/api/tasks/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const { data, error } = await supabase
      .from('tasks')
      .update({ 
        status: 'rejected',
        rejected_at: new Date().toISOString(),
        rejection_reason: reason
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, task: data });

  } catch (err) {
    console.error('Reject task error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Liste des tâches
app.get('/api/tasks', async (req, res) => {
  try {
    const { status, limit = 50 } = req.query;
    
    let query = supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({ tasks: data });

  } catch (err) {
    console.error('List tasks error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ROUTES - EMAIL NOTIFICATIONS
// ============================================================================

async function sendEmailNotification({ subject, body }) {
  if (!emailTransporter) {
    console.log('📧 Email not configured, skipping notification');
    return;
  }

  try {
    await emailTransporter.sendMail({
      from: CONFIG.EMAIL.from,
      to: CONFIG.EMAIL.to,
      subject,
      html: body
    });
    console.log('📧 Email sent:', subject);
  } catch (err) {
    console.error('Email error:', err);
  }
}

// Endpoint pour tester l'email
app.post('/api/test-email', async (req, res) => {
  try {
    await sendEmailNotification({
      subject: '🧪 Test notification Copilote',
      body: '<h2>Test réussi !</h2><p>Les notifications email fonctionnent.</p>'
    });
    res.json({ success: true, message: 'Email envoyé' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ROUTES - BUDGET
// ============================================================================

app.get('/api/budget', (req, res) => {
  resetDailyStatsIfNeeded();
  res.json({
    date: dailyStats.date,
    daily_limit_usd: CONFIG.DAILY_BUDGET_USD,
    used_usd: dailyStats.cost_usd.toFixed(4),
    remaining_usd: (CONFIG.DAILY_BUDGET_USD - dailyStats.cost_usd).toFixed(4),
    tokens_used: dailyStats.tokens_used,
    tokens_limit: CONFIG.DAILY_TOKEN_LIMIT,
    api_calls: dailyStats.api_calls,
    max_per_task: CONFIG.MAX_COST_PER_TASK
  });
});

// ============================================================================
// CATCH-ALL - SERVE REACT APP
// ============================================================================

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       🚀 COPILOTE PLANETEBEAUTY - DASHBOARD                  ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║   URL: http://localhost:${PORT}                                  ║`);
  console.log(`║   Budget: $${CONFIG.DAILY_BUDGET_USD}/jour | Max/tâche: $${CONFIG.MAX_COST_PER_TASK}               ║`);
  console.log('║                                                              ║');
  console.log('║   Services:                                                  ║');
  console.log(`║   - Supabase: ${CONFIG.SUPABASE_URL ? '✅' : '❌'}                                       ║`);
  console.log(`║   - Claude API: ${CONFIG.ANTHROPIC_API_KEY ? '✅' : '❌'}                                      ║`);
  console.log(`║   - Email: ${emailTransporter ? '✅' : '❌'}                                           ║`);
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
});
