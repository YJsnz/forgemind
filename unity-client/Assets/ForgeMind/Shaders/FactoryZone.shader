Shader "ForgeMind/FactoryZone"
{
    Properties
    {
        _BaseColor("Zone Color", Color) = (0.3, 0.5, 0.5, 0.12)
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        Pass
        {
            CGPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "UnityCG.cginc"

            struct Attributes { float4 vertex : POSITION; };
            struct Varyings { float4 position : SV_POSITION; };
            fixed4 _BaseColor;

            Varyings Vert(Attributes input)
            {
                Varyings output;
                output.position = UnityObjectToClipPos(input.vertex);
                return output;
            }

            fixed4 Frag(Varyings input) : SV_Target { return _BaseColor; }
            ENDCG
        }
    }
}
