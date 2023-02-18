<template>
  <div>
    <img alt="Vue logo" :src="url" />
    <HelloWorld msg="Hello Vue 3 + Vite" />
    <router-link to="/page2">Go to page2</router-link>
    <div>
      <button @click="testHref">测试location跳转</button>
    </div>
  </div>
</template>

<script setup>
import HelloWorld from '../components/HelloWorld.vue'
import { defineProps, reactive } from 'vue'

const url = reactive(new URL('../assets/logo.png', import.meta.url).href)

const testHref = () => {
  // 通过原生跳转会导致报错
  // location.href = 'http://localhost:7001/micro-app/vite/#/page2' // 报错
  // location.href = '/micro-app/vite/#/page2' // 报错
  // location.href = 'https://www.baidu.com/' // 报错
  // location.href = 'http://localhost:3000/micro-app/vite/#/page2' // -- 不报错 --

  // vite环境下，通过window.microApp.location进行跳转
  // window.microApp.location.href = 'https://www.baidu.com/' // origin不同，直接跳转页面
  window.microApp.location.href = '/micro-app/vite/page2'
}

// This starter template is using Vue 3 experimental <script setup> SFCs
// Check out https://github.com/vuejs/rfcs/blob/script-setup-2/active-rfcs/0000-script-setup.md
</script>
<style>
</style>
