---
layout: single
permalink: /news/
title: "Daily News · 每日资讯"
author_profile: true
---

{% assign news = site.data.daily_news %}

每日 AI 热点，自动同步自 **[{{ news.sourceName | escape }}]({{ news.sourceUrl | escape }})**（GitHub Actions 每天定时抓取两次并自动发布）。最近同步：{{ news.updatedAt | date: "%Y-%m-%d %H:%M" }} UTC · 评分与完整推荐理由见 [源站]({{ news.sourceUrl | escape }})。

<style>
.news-day { margin-top: 1.6em; }
.news-day__head { display: flex; align-items: baseline; gap: 10px; border-bottom: 2px solid currentColor; padding-bottom: 4px; opacity: 0.9; }
.news-day__head h2 { margin: 0; border: none; font-size: 1.25rem; }
.news-day__count { font-size: 0.85rem; opacity: 0.55; }
.news-item { padding: 14px 0 12px; border-bottom: 1px solid rgba(128,128,128,0.22); }
.news-item__meta { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; font-size: 0.8rem; opacity: 0.75; }
.news-time { font-variant-numeric: tabular-nums; font-weight: 600; }
.news-cat { border: 1px solid currentColor; border-radius: 999px; padding: 0 8px; font-size: 0.72rem; line-height: 1.7; opacity: 0.8; }
.news-item h3 { margin: 4px 0 4px; font-size: 1.02rem; line-height: 1.45; }
.news-item h3 a { text-decoration: none; }
.news-item h3 a:hover { text-decoration: underline; }
.news-item p { margin: 0; font-size: 0.92rem; line-height: 1.65; opacity: 0.82; }
.news-item__link { font-size: 0.8rem; opacity: 0.6; }
</style>

{% for day in news.days %}
<div class="news-day">
  <div class="news-day__head">
    <h2>{{ day.date | escape }} · {{ day.weekday | escape }}</h2>
    <span class="news-day__count">{{ day.count }} 条</span>
  </div>
  {% for item in day.items %}
  <article class="news-item">
    <div class="news-item__meta">
      <span class="news-time">{{ item.time | escape }}</span>
      {% if item.category %}<span class="news-cat">{{ item.category | escape }}</span>{% endif %}
      <span>{{ item.source | escape }}</span>
    </div>
    {% assign item_href = item.originalUrl | default: item.itemUrl %}
    {% assign item_href_scheme = item_href | slice: 0, 8 %}
    <h3>{% if item_href_scheme == "https://" %}<a href="{{ item_href | escape }}" rel="noopener noreferrer">{{ item.title | escape }}</a>{% else %}{{ item.title | escape }}{% endif %}</h3>
    <p>{{ item.summary | escape }}</p>
  </article>
  {% endfor %}
</div>
{% endfor %}

<p class="news-item__link">数据来自 {{ news.sourceName | escape }} 的公开 RSS，版权归原信源所有；本站每 12 小时自动同步一次。</p>
