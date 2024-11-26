<template>
  <div class="react16">
    <div class='btn-con'>
      <el-button type="primary" round @click='toggleShow'>微应用是否展示</el-button>
      <el-button type="primary" round @click='changeData'>data属性发送数据</el-button>
      <el-button type="primary" round @click='dispatchData'>dispatch方法发送数据</el-button>
      <el-button type="primary" round @click='dispatchGlobalData'>发送全局数据</el-button>
      <el-button type="primary" round @click='changeTestNum'>testNum -- {{testNum}}</el-button>
    </div>
    <div class='micro-app-con'>
      <micro-app-vue
        v-if="showMicroApp"
        :data='microAppData'
        :name='name'
        :url='url'
        router-mode="state"
        @created='created'
        @beforemount='beforemount'
        @mounted='mounted'
        @unmount='unmount'
        @error='error'
        @datachange='handleDataChange'
        iframe="false"
      >
      <!-- destroy inline baseRoute='/react16' -->
      </micro-app-vue>
    </div>
  </div>
</template>

<script>
import microApp from '@micro-zoe/micro-app'
import config from '../config'

export default {
  name: 'nest',
  data() {
    return {
      microAppData: {
        name: '初始化数据'
      },
      name: 'nest-react16',
      url: `${config.react16}micro-app/react16/`,
      showMicroApp: true,
      testNum: 0,
    }
  },
  mounted () {
    microApp.addDataListener(this.name, (data) => {
      console.log('来自子应用react16的数据', data)
    })

    microApp.addGlobalDataListener((data) => {
      console.log('这是全局数据--基座应用', data)
    })
  },
  methods: {
    created () {
      console.log('生命周期：created')
    },
    beforemount (e) {
      console.log('生命周期：beforemount', e)
    },
    mounted () {
      console.log('生命周期：mounted')
    },
    unmount () {
      console.log('生命周期：unmount')
    },
    error () {
      console.log('生命周期：error')
    },
    handleDataChange (e) {
      console.log('通过生命周周期监听到来自子应用的数据', e)
      this.$alert(JSON.stringify(e.detail.data), '来自子应用的数据', {
        confirmButtonText: '确定',
        callback: action => {
          this.$message({
            type: 'info',
            message: `action: ${ action }`
          });
        }
      })
    },
    toggleShow () {
      this.showMicroApp = !this.showMicroApp
    },
    changeData () {
      this.microAppData = { name: +new Date() }
    },
    dispatchData () {
      microApp.setData(this.name, {dispatch: 'data from dispatch' + (+new Date())})
    },
    dispatchGlobalData () {
      microApp.setGlobalData({name: '全局数据' + (+new Date())})
    },
    changeTestNum () {
      this.testNum = this.testNum + 1
    }
  },

}
</script>

<style>
  .react16 {
    display: flex;

  }

  .btn-con {
    display: flex;
    flex-direction: column;
    width: 200px;
  }

  .btn-con button {
    margin: 5px;
  }

  .micro-app-con {
    flex: 1;
  }
</style>

