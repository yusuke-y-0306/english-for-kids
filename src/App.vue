<script setup>
const features = [
  { emoji: '🃏', title: 'フラッシュカード', desc: '英単語を楽しく覚えよう' },
  { emoji: '🎤', title: '発音練習', desc: '声に出して練習しよう' },
  { emoji: '🎮', title: 'クイズ・ゲーム', desc: '遊びながら学ぼう' },
  { emoji: '📈', title: '進捗管理', desc: 'がんばりを見える化' },
]
</script>

<template>
  <main class="home">
    <h1>🧒📚 English for Kids</h1>
    <p class="subtitle">子供たちが楽しく英語を学べるアプリ</p>

    <section class="features">
      <div v-for="f in features" :key="f.title" class="card">
        <div class="emoji">{{ f.emoji }}</div>
        <h2>{{ f.title }}</h2>
        <p>{{ f.desc }}</p>
      </div>
    </section>

    <footer>🚧 開発中 — 随時アップデート予定</footer>
  </main>
</template>

<style scoped>
.home {
  max-width: 720px;
  margin: 0 auto;
  padding: 2rem 1rem;
  text-align: center;
}
h1 {
  font-size: 2.2rem;
  margin-bottom: 0.3rem;
}
.subtitle {
  color: #666;
  margin-bottom: 2rem;
}
.features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
}
.card {
  border: 1px solid #ddd;
  border-radius: 12px;
  padding: 1.2rem 0.8rem;
  background: #fafafa;
}
.emoji {
  font-size: 2rem;
}
.card h2 {
  font-size: 1rem;
  margin: 0.5rem 0 0.3rem;
}
.card p {
  font-size: 0.85rem;
  color: #666;
  margin: 0;
}
footer {
  margin-top: 2.5rem;
  color: #999;
  font-size: 0.85rem;
}
</style>
