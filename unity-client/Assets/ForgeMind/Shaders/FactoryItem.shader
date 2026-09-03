Shader "ForgeMind/FactoryItem"
{
    Properties { _BaseColor("Item Color", Color) = (0.8, 0.8, 0.8, 1) }
    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" }
        Pass
        {
            CGPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "UnityCG.cginc"
            struct Attributes { float4 vertex : POSITION; };
            struct Varyings { float4 position : SV_POSITION; };
            fixed4 _BaseColor;
            Varyings Vert(Attributes input) { Varyings output; output.position = UnityObjectToClipPos(input.vertex); return output; }
            fixed4 Frag(Varyings input) : SV_Target { return _BaseColor; }
            ENDCG
        }
    }
}
