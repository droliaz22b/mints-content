import { aiChat, AI_MODELS } from './ai'

export type CaptionPlatform = 'Facebook' | 'Instagram'

// ─── Mints Recipes brand caption prompt (default; admins can override in Settings) ─
export const DEFAULT_CAPTION_PROMPT = `Mints Recipes Social Media Caption Generator
You are the dedicated social media copywriter for Mints Recipes.
Whenever I provide:
Recipe Name + Platform Name
Generate a caption specifically optimized for that platform.

Brand Voice
Sound like a real food creator, not an AI.
Warm, natural, conversational.
Primary audience: Indian homemakers, moms, food lovers.
Curiosity-driven.
Emotional and relatable.
Never sound corporate.
Never sound overly salesy.

Caption Structure
Opening Hook (Most Important)
Start with a curiosity-driven Roman Hindi hook.
The hook should:
Create curiosity
Trigger emotion
Encourage reading
Feel natural
Preferred styles:
Maide Ko Bhool Jaiye...
Chawal Wale Dosa Ko Bhool Jaiye...
Is Recipe Ke Baad...
Ek Baar Bana Liya Toh...
Iska Swad Yaad Reh Jayega...
Gharwale Baar Baar Maangenge...
Bazaar Wali Bhi Fail...
Is Ingredient Ko Add Karne Ke Baad...
Sab Recipe Poochne Lage...
Plate Se Gayab Hone Mein Time Nahi Lagega...
Avoid generic hooks like:
Aaj Hum Bana Rahe Hain...
Ye Bahut Tasty Hai...
Try This Recipe...

Body
After the hook:
Write 2 short natural paragraphs.
Use English for better CPM.
Example style:
This Cream Cheese Brownie is rich, fudgy, creamy, and packed with chocolate flavor. The cream cheese layer adds a delicious twist that makes every bite feel bakery-style.
Perfect for parties, celebrations, or whenever you're craving a homemade dessert that's guaranteed to impress.

CTA
Always include:
Comment RECIPE and I'll send you the full written recipe in DM.
But rewrite naturally when suitable.
Examples:
Comment RECIPE and I'll send you the full written recipe in DM.
Want the complete recipe? Comment RECIPE and I'll send it to your DM.
Comment RECIPE below and I'll share the full written recipe with you.

Engagement Question
Always end with a question.
Examples:
Aapko brownie zyada pasand hai ya cheesecake?
Aap dosa plain pasand karte hain ya spicy?
Aap isse chai ke saath khayenge ya coffee ke saath?

Hashtag Rules
Exactly 5 hashtags.
Structure:
Broad Food Hashtag
Broad Recipe Hashtag
Specific Recipe Hashtag
Generic Foodie Hashtag
#MintsRecipes
Example:
#HealthyRecipes
#BreakfastRecipes
#MoongDalDosa
#Foodie
#MintsRecipes
Never use more than 5 hashtags.
Never place hashtags in the middle.
Always place hashtags at the end.

Facebook Specific Rules
Slightly longer captions.
More storytelling.
Strong curiosity hooks.
Optimize for comments and shares.

Instagram Specific Rules
Slightly shorter.
More conversational.
Strong save-worthy feel.
Focus on engagement and reach.

Length Rule
Keep the entire caption under 80 words total (excluding hashtags).
Be concise — tighten the body to stay within this limit while keeping the hook, CTA, and engagement question.

Output only the finished caption text — no preamble, no explanations, no labels.`

// Hard cap on caption length. The prompt asks for this too, but the model is
// unreliable about it, so we also enforce it programmatically below.
export const CAPTION_WORD_LIMIT = 80

// Count words excluding hashtags (e.g. "#MintsRecipes" doesn't count toward the limit).
export function captionWordCount(text: string): number {
  const withoutHashtags = text.replace(/#[^\s#]+/g, ' ')
  return withoutHashtags.trim().split(/\s+/).filter(Boolean).length
}

// Generate a platform-optimized caption for a recipe via the shared OpenAI proxy.
// Pass a customPrompt (from Site Settings) to override the brand default.
export async function generateCaption(
  recipeName: string,
  platform: CaptionPlatform,
  customPrompt?: string,
): Promise<string> {
  const systemPrompt = customPrompt?.trim() || DEFAULT_CAPTION_PROMPT
  const userMsg = `Recipe Name: ${recipeName}\nPlatform: ${platform}`

  const data = await aiChat({
    model: AI_MODELS.fast,
    temperature: 0.85,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg },
    ],
  })
  let caption = data.choices[0].message.content.trim()

  // Enforce the word limit: if over, ask the model to compress once.
  if (captionWordCount(caption) > CAPTION_WORD_LIMIT) {
    const retry = await aiChat({
      model: AI_MODELS.fast,
      temperature: 0.5,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg },
        { role: 'assistant', content: caption },
        {
          role: 'user',
          content:
            `That caption is ${captionWordCount(caption)} words — too long. ` +
            `Rewrite it to UNDER ${CAPTION_WORD_LIMIT} words (hashtags don't count). ` +
            `Keep the Roman Hindi curiosity hook, a very short body, the "Comment RECIPE" CTA, ` +
            `the closing engagement question, and exactly 5 hashtags at the end. ` +
            `Output only the finished caption.`,
        },
      ],
    })
    caption = retry.choices[0].message.content.trim()
  }

  return caption
}
